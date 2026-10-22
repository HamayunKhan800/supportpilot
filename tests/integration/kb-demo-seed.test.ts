import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedDemoKnowledgeBase } from "@/server/modules/kb/demo-seed";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { runIngestJob } from "@/server/modules/kb/ingest-job";
import { listDocuments } from "@/server/modules/kb/repository";
import { getDb } from "@/server/platform/db/client";
import { organization, user } from "@/server/platform/db/schema";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { KB_INGEST_QUEUE } from "@/server/platform/jobs/queues";

import { loadCorpus } from "../../scripts/lib/kb-corpus";
import { resetDatabase } from "./support/client";

const corpus = loadCorpus();
let nimbusId: string, otherId: string, adminId: string;

const queuedJobs = async (workspaceId: string) =>
  (
    await getDb().pool.query<{ data: { workspaceId: string; documentId: string } }>(
      `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'workspaceId' = $2`,
      [KB_INGEST_QUEUE, workspaceId],
    )
  ).rows.map((r) => r.data);

beforeAll(async () => {
  await resetDatabase();
  await getDb().pool.query(`DELETE FROM pgboss.job`);
  nimbusId = randomUUID();
  otherId = randomUUID();
  adminId = randomUUID();
  await getDb()
    .db.insert(organization)
    .values([
      { id: nimbusId, name: "Nimbus Cloud Storage", slug: "nimbus-demo", createdAt: new Date() },
      { id: otherId, name: "Other", slug: "other", createdAt: new Date() },
    ]);
  await getDb().db.insert(user).values({ id: adminId, name: "Adam Admin", email: "admin@nimbus.test" });
});

afterAll(async () => {
  await stopWebBoss();
});

describe("seedDemoKnowledgeBase", () => {
  it("stores every article and queues one ingestion job per document, in the demo workspace only", async () => {
    expect(await seedDemoKnowledgeBase(nimbusId, adminId, corpus)).toBe(corpus.length);

    const docs = await listDocuments(nimbusId);
    expect(docs).toHaveLength(corpus.length);
    expect(docs.every((d) => d.status === "pending" && d.uploadedBy === adminId)).toBe(true);
    expect(new Set(docs.map((d) => d.title))).toEqual(new Set(corpus.map((a) => a.title)));
    expect(docs.filter((d) => d.mimeType === "application/pdf")).toHaveLength(
      corpus.filter((a) => a.format === "pdf").length,
    );

    const jobs = await queuedJobs(nimbusId);
    expect(jobs.map((j) => j.documentId).sort()).toEqual(docs.map((d) => d.id).sort());
    expect(await listDocuments(otherId)).toEqual([]);
  });

  it("does nothing the second time, even when run concurrently", async () => {
    const results = await Promise.all([
      seedDemoKnowledgeBase(nimbusId, adminId, corpus),
      seedDemoKnowledgeBase(nimbusId, adminId, corpus),
    ]);
    expect(results).toEqual([0, 0]);
    expect(await listDocuments(nimbusId)).toHaveLength(corpus.length);
    expect(await queuedJobs(nimbusId)).toHaveLength(corpus.length);
  });

  it("seeds only once when two first runs race", async () => {
    const results = await Promise.all([
      seedDemoKnowledgeBase(otherId, adminId, corpus.slice(0, 2)),
      seedDemoKnowledgeBase(otherId, adminId, corpus.slice(0, 2)),
    ]);
    expect(results.sort()).toEqual([0, 2]);
    expect(await listDocuments(otherId)).toHaveLength(2);
  });

  it("queues documents the worker can index: every article becomes ready", async () => {
    const embedder = createMockEmbedder();
    for (const job of await queuedJobs(nimbusId)) {
      const outcome = await runIngestJob(job, { isFinalAttempt: true }, { embedder });
      expect(outcome.status, job.documentId).toBe("ready");
    }
    const docs = await listDocuments(nimbusId);
    expect(docs.every((d) => d.status === "ready" && d.chunkCount > 0)).toBe(true);
    expect(docs.filter((d) => d.pageCount !== null).every((d) => d.pageCount! > 1)).toBe(true);
  });

  it("refuses a demo that would not fit the workspace limits, without writing anything", async () => {
    const huge = { ...corpus[0]!, bytes: Buffer.alloc(51 * 1024 * 1024) };
    const fresh = randomUUID();
    await getDb()
      .db.insert(organization)
      .values({ id: fresh, name: "Fresh", slug: "fresh", createdAt: new Date() });
    await expect(seedDemoKnowledgeBase(fresh, adminId, [huge])).rejects.toThrow(/limits/);
    expect(await listDocuments(fresh)).toEqual([]);
  });
});
