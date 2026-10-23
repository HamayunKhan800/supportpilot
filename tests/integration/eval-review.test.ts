import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as verdictRoute } from "@/app/api/internal/review/items/[id]/verdict/route";
import { buildReviewItems, contentHash } from "../../scripts/lib/review-items";
import { reviewContent, type ReviewSet } from "@/server/modules/eval-review/content";
import * as repo from "@/server/modules/eval-review/repository";
import { ReviewVerdictSaved } from "@/server/modules/eval-review/schemas";
import { getReviewItemPage, getReviewOverview } from "@/server/modules/eval-review/service";
import { getAuth } from "@/server/platform/auth";
import { getDb } from "@/server/platform/db/client";
import { evalReviewItem } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { resetEnvCache } from "@/server/platform/env";
import { AppError } from "@/server/platform/errors";

import { ORIGIN, resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * The evaluation Review page (M6 D2) against a real database: who can see it, how verdicts
 * are saved and protected, and how reloading the datasets treats existing verdicts.
 */

const handler = (req: Request) => getAuth().handler(req);
const db = () => getDb().db;
const REVIEWER = "reviewer@acme.test";

let reviewer: TestClient, stranger: TestClient;

const item = (set: ReviewSet, itemKey: string, position: number, value = `Content of ${itemKey}`) => {
  const content = reviewContent.parse({
    title: `Item ${itemKey}`,
    fields: [{ label: "Message", value, kind: "quote" }],
    question: "Is this right?",
  });
  return { set, itemKey, position, content, contentHash: contentHash(content) };
};

const SEEDS = [
  item("triage-labels", "t-1", 1),
  item("triage-labels", "t-2", 2),
  item("triage-labels", "t-3", 3),
];

const sync = (seeds: repo.ReviewItemSeed[], sets: ReviewSet[] = ["triage-labels"]) =>
  transaction((tx) => repo.syncItems(tx, sets, seeds));

const rowOf = async (itemKey: string) =>
  (await db().select().from(evalReviewItem).where(eq(evalReviewItem.itemKey, itemKey)))[0]!;

function postVerdict(
  id: string,
  body: unknown,
  opts: { as?: TestClient; origin?: string | null; site?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.as) headers.set("cookie", opts.as.cookieHeader);
  if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  if (opts.site) headers.set("sec-fetch-site", opts.site);
  const req = new Request(new URL(`/api/internal/review/items/${id}/verdict`, ORIGIN), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return verdictRoute(req, { params: Promise.resolve({ id }) });
}

async function status(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    if (err instanceof AppError) return err.status;
    throw err;
  }
}

function enable(list: string | undefined) {
  if (list === undefined) delete process.env.EVAL_REVIEWER_EMAILS;
  else process.env.EVAL_REVIEWER_EMAILS = list;
  resetEnvCache();
}

beforeAll(async () => {
  await resetDatabase();
  reviewer = await signUpAndIn(handler, REVIEWER);
  stranger = await signUpAndIn(handler, "owner@globex.test");
});

beforeEach(async () => {
  enable(` ${REVIEWER.toUpperCase()} `); // matching ignores case and spaces
  await db().delete(evalReviewItem);
  await sync(SEEDS);
});

afterAll(() => enable(undefined));

describe("access (allowlist, not a workspace role)", () => {
  it("lets a listed reviewer see the overview", async () => {
    const sets = await getReviewOverview(reviewer.headers);
    expect(sets.find((s) => s.set === "triage-labels")).toMatchObject({ total: 3, reviewed: 0, agreed: 0 });
    expect(sets.find((s) => s.set === "drafts")).toMatchObject({ total: 0 });
  });

  it("hides the page (404) from anyone else, and asks signed-out visitors to sign in (401)", async () => {
    expect(await status(getReviewOverview(stranger.headers))).toBe(404);
    expect(await status(getReviewItemPage(stranger.headers, "triage-labels"))).toBe(404);
    expect(await status(getReviewOverview(new Headers()))).toBe(401);
  });

  it("is off for everyone, the reviewer included, when no reviewers are configured", async () => {
    enable(undefined);
    expect(await status(getReviewOverview(reviewer.headers))).toBe(404);
    expect(await status(getReviewOverview(new Headers()))).toBe(404); // doesn't even ask to sign in
    const id = (await rowOf("t-1")).id;
    expect(
      (await postVerdict(id, { contentHash: SEEDS[0]!.contentHash, verdict: "agree" }, { as: reviewer }))
        .status,
    ).toBe(404);
  });

  it("answers anyone not allowed with the same 404 whatever they send, so the endpoint can't be found", async () => {
    const id = (await rowOf("t-1")).id;
    const sent = async (body: unknown, opts: Parameters<typeof postVerdict>[2] = {}) =>
      (await postVerdict(id, body, opts)).status;
    // A bad body or a cross-site origin would otherwise get 400 or 403 and reveal the endpoint.
    expect(await sent({}, { as: stranger })).toBe(404);
    expect(await sent({}, { as: stranger, origin: "https://evil.example" })).toBe(404);
    expect(await sent({})).toBe(401); // on, signed out: asked to sign in, as on the page
    enable(undefined);
    expect(await sent({})).toBe(404);
    expect(await sent({}, { as: reviewer })).toBe(404);
    expect(await sent({}, { origin: "https://evil.example" })).toBe(404);
  });

  it("refuses verdicts from non-reviewers without saving anything", async () => {
    const row = await rowOf("t-1");
    const res = await postVerdict(
      row.id,
      { contentHash: row.contentHash, verdict: "agree" },
      { as: stranger },
    );
    expect(res.status).toBe(404);
    expect((await rowOf("t-1")).verdict).toBeNull();
  });
});

describe("item pages", () => {
  it("opens the first unchecked item, with its position and neighbours", async () => {
    const t1 = await rowOf("t-1");
    await repo.saveVerdict(db(), {
      id: t1.id,
      contentHash: t1.contentHash,
      verdict: "agree",
      note: null,
      userId: await userId(),
    });
    const page = await getReviewItemPage(reviewer.headers, "triage-labels");
    expect(page).toMatchObject({ index: 2, total: 3, reviewed: 1, prevKey: "t-1", nextKey: "t-3" });
    expect(page.item).toMatchObject({ itemKey: "t-2", verdict: null, contentHash: SEEDS[1]!.contentHash });
  });

  it("opens a named item, and 404s for an unknown item, set or empty set", async () => {
    expect((await getReviewItemPage(reviewer.headers, "triage-labels", "t-3")).index).toBe(3);
    expect(await status(getReviewItemPage(reviewer.headers, "triage-labels", "nope"))).toBe(404);
    expect(await status(getReviewItemPage(reviewer.headers, "not-a-set"))).toBe(404);
    expect(await status(getReviewItemPage(reviewer.headers, "drafts"))).toBe(404);
  });
});

async function userId() {
  return (await getAuth().api.getSession({ headers: reviewer.headers }))!.user.id;
}

describe("saving a verdict (POST /api/internal/review/items/{id}/verdict)", () => {
  it("saves an answer with a note, and points to the next unchecked item", async () => {
    const row = await rowOf("t-2");
    const res = await postVerdict(
      row.id,
      { contentHash: row.contentHash, verdict: "disagree", note: "  Priority should be high (H1).  " },
      { as: reviewer },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = ReviewVerdictSaved.parse(await res.json());
    expect(body).toMatchObject({
      itemKey: "t-2",
      verdict: "disagree",
      nextUnreviewedKey: "t-3",
      reviewed: 1,
      total: 3,
    });

    const saved = await rowOf("t-2");
    expect(saved).toMatchObject({
      verdict: "disagree",
      note: "Priority should be high (H1).",
      reviewedBy: await userId(),
    });
    expect(saved.reviewedAt).toBeInstanceOf(Date);
  });

  it("lets the reviewer change an answer, and clears a note sent empty", async () => {
    const row = await rowOf("t-1");
    await postVerdict(
      row.id,
      { contentHash: row.contentHash, verdict: "disagree", note: "Wrong" },
      { as: reviewer },
    );
    const res = await postVerdict(
      row.id,
      { contentHash: row.contentHash, verdict: "agree", note: "" },
      { as: reviewer },
    );
    expect(res.status).toBe(200);
    expect(await rowOf("t-1")).toMatchObject({ verdict: "agree", note: null });
  });

  it("reports when the whole set is done", async () => {
    let last: ReviewVerdictSaved | undefined;
    for (const key of ["t-1", "t-2", "t-3"]) {
      const row = await rowOf(key);
      const res = await postVerdict(
        row.id,
        { contentHash: row.contentHash, verdict: "agree" },
        { as: reviewer },
      );
      last = ReviewVerdictSaved.parse(await res.json());
    }
    expect(last).toMatchObject({ nextUnreviewedKey: null, reviewed: 3, total: 3 });
    const overview = await getReviewOverview(reviewer.headers);
    expect(overview.find((s) => s.set === "triage-labels")).toMatchObject({ reviewed: 3, agreed: 3 });
  });

  it("refuses a verdict on content the reviewer didn't see (409), and saves nothing", async () => {
    const row = await rowOf("t-1");
    const res = await postVerdict(
      row.id,
      { contentHash: "f".repeat(64), verdict: "agree" },
      { as: reviewer },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/updated after you opened it/);
    expect((await rowOf("t-1")).verdict).toBeNull();
  });

  it("validates the body and the item id", async () => {
    const row = await rowOf("t-1");
    const bad = async (body: unknown, id = row.id) => (await postVerdict(id, body, { as: reviewer })).status;
    expect(await bad({ contentHash: row.contentHash, verdict: "maybe" })).toBe(400);
    expect(await bad({ contentHash: row.contentHash, verdict: "agree", note: "x".repeat(501) })).toBe(400);
    expect(await bad({ contentHash: row.contentHash, verdict: "agree", reviewedBy: "someone" })).toBe(400);
    expect(await bad({ contentHash: row.contentHash, verdict: "agree" }, "not-a-uuid")).toBe(404);
    expect(await bad({ contentHash: row.contentHash, verdict: "agree" }, crypto.randomUUID())).toBe(404);
  });

  it("rejects cross-site requests that carry the reviewer's cookie (CSRF, T5)", async () => {
    const row = await rowOf("t-1");
    const body = { contentHash: row.contentHash, verdict: "agree" };
    expect((await postVerdict(row.id, body, { as: reviewer, origin: "https://evil.example" })).status).toBe(
      403,
    );
    expect((await postVerdict(row.id, body, { as: reviewer, origin: null })).status).toBe(403);
    expect((await postVerdict(row.id, body, { as: reviewer, site: "cross-site" })).status).toBe(403);
    expect((await rowOf("t-1")).verdict).toBeNull();
  });

  it("asks a signed-out caller to sign in", async () => {
    const row = await rowOf("t-1");
    expect((await postVerdict(row.id, { contentHash: row.contentHash, verdict: "agree" })).status).toBe(401);
  });
});

describe("reloading the datasets (pnpm eval:review load)", () => {
  it("keeps verdicts on unchanged items, resets changed ones, and removes dropped ones", async () => {
    for (const key of ["t-1", "t-2"]) {
      const row = await rowOf(key);
      await postVerdict(
        row.id,
        { contentHash: row.contentHash, verdict: "disagree", note: "x" },
        { as: reviewer },
      );
    }
    const result = await sync([
      item("triage-labels", "t-1", 1), // unchanged
      item("triage-labels", "t-2", 2, "Fixed after the review"), // changed after review
      item("triage-labels", "t-4", 3), // new; t-3 dropped
    ]);
    expect(result).toEqual({ inserted: 1, reset: 1, updated: 0, unchanged: 1, removed: 1 });
    expect(await rowOf("t-1")).toMatchObject({ verdict: "disagree", note: "x" });
    expect(await rowOf("t-2")).toMatchObject({
      verdict: null,
      note: null,
      reviewedBy: null,
      reviewedAt: null,
    });
    expect((await rowOf("t-2")).content.fields[0]!.value).toBe("Fixed after the review");
    expect(await rowOf("t-3")).toBeUndefined();
  });

  it("only touches the sets being loaded", async () => {
    await sync([item("drafts", "d-1", 1)], ["drafts"]);
    await sync([], ["triage-labels"]);
    expect(await rowOf("d-1")).toBeDefined();
    expect(await rowOf("t-1")).toBeUndefined();
    await expect(sync([item("drafts", "d-2", 1)], ["triage-labels"])).rejects.toThrow(/isn't being synced/);
  });

  it("loads the real review sample, and loading it again changes nothing", async () => {
    const seeds = buildReviewItems();
    const sets: ReviewSet[] = ["label-changes", "triage-labels", "retrieval-labels"];
    expect(await sync(seeds, sets)).toMatchObject({ inserted: seeds.length, removed: 3 });
    expect(await sync(seeds, sets)).toEqual({
      inserted: 0,
      reset: 0,
      updated: 0,
      unchanged: seeds.length,
      removed: 0,
    });
  });
});

describe("database rules", () => {
  it("rejects inconsistent rows even when written directly", async () => {
    const { pool } = getDb();
    const row = await rowOf("t-1");
    const attempt = (sql: string) =>
      pool.query(sql, [row.id]).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    // A verdict needs a time; a note needs a verdict; unknown verdicts and sets are refused.
    expect(await attempt(`UPDATE eval_review_item SET verdict = 'agree' WHERE id = $1`)).toBe("23514");
    expect(await attempt(`UPDATE eval_review_item SET note = 'hi' WHERE id = $1`)).toBe("23514");
    expect(
      await attempt(`UPDATE eval_review_item SET verdict = 'maybe', reviewed_at = now() WHERE id = $1`),
    ).toBe("23514");
    expect(await attempt(`UPDATE eval_review_item SET "set" = 'other' WHERE id = $1`)).toBe("23514");
    expect(await attempt(`UPDATE eval_review_item SET content_hash = 'abc' WHERE id = $1`)).toBe("23514");
  });

  it("keeps a verdict, without the reviewer link, if the reviewer's account is deleted", async () => {
    const row = await rowOf("t-1");
    const temp = await signUpAndIn(handler, "temp-reviewer@acme.test");
    const tempId = (await getAuth().api.getSession({ headers: temp.headers }))!.user.id;
    await repo.saveVerdict(db(), {
      id: row.id,
      contentHash: row.contentHash,
      verdict: "agree",
      note: null,
      userId: tempId,
    });
    await getDb().pool.query(`DELETE FROM "user" WHERE id = $1`, [tempId]);
    expect(await rowOf("t-1")).toMatchObject({ verdict: "agree", reviewedBy: null });
  });
});
