/**
 * Loads the synthetic Nimbus help centre into the demo workspace (plan M4 step 6, D14).
 * Articles go through the same path as an upload: the document and its bytes are stored,
 * and an ingestion job is queued in the same transaction, so the worker extracts, chunks
 * and embeds them exactly as it would a real upload.
 *
 * - Idempotent: does nothing if the workspace already has any knowledge-base document.
 * - All or nothing: one transaction, serialised per workspace with an advisory lock.
 * - No audit events: like the demo tickets, these weren't uploaded by a real person.
 * - The caller supplies the articles (scripts/lib/kb-corpus.ts reads them from eval/corpus),
 *   so this module never touches the file system.
 */
import { eq, sql } from "drizzle-orm";

import { kbDocument } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { enqueueKbIngest } from "@/server/platform/jobs/boss";

import { KB_MAX_DOCUMENTS_PER_WORKSPACE, KB_MAX_WORKSPACE_BYTES } from "./limits";
import * as repo from "./repository";

export interface DemoArticle {
  title: string;
  filename: string;
  mimeType: repo.KbMimeType;
  bytes: Buffer;
  sha256: string;
}

export async function seedDemoKnowledgeBase(
  workspaceId: string,
  uploadedBy: string,
  articles: readonly DemoArticle[],
): Promise<number> {
  const totalBytes = articles.reduce((n, a) => n + a.bytes.byteLength, 0);
  // The demo must fit the caps a real workspace has, or it would show an impossible state.
  if (articles.length > KB_MAX_DOCUMENTS_PER_WORKSPACE || totalBytes > KB_MAX_WORKSPACE_BYTES) {
    throw new Error("Demo knowledge base exceeds the workspace limits");
  }
  return transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"demo-kb-seed:" + workspaceId}))`);
    const [existing] = await tx
      .select({ id: kbDocument.id })
      .from(kbDocument)
      .where(eq(kbDocument.workspaceId, workspaceId))
      .limit(1);
    if (existing) return 0;
    for (const article of articles) {
      const doc = await repo.insertDocument(tx, workspaceId, {
        title: article.title,
        filename: article.filename,
        mimeType: article.mimeType,
        bytes: article.bytes,
        sha256: article.sha256,
        uploadedBy,
      });
      await enqueueKbIngest(tx, { workspaceId, documentId: doc.id });
    }
    return articles.length;
  });
}
