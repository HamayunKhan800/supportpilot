import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { summariseReview } from "../../scripts/lib/review-export";
import {
  buildReviewItems,
  contentHash,
  everyFifth,
  labelChangeItems,
  retrievalLabelItems,
  triageLabelItems,
} from "../../scripts/lib/review-items";
import { loadDemoLabelFile } from "../../scripts/lib/triage-set";
import { internalOperations } from "@/server/api/internal-operations";
import { buildOpenApiDocument } from "@/server/api/openapi";
import { operations } from "@/server/api/operations";
import { RUBRIC_RULE_IDS, RUBRIC_RULES } from "@/server/modules/eval/rubric";
import { formatRate, wilson } from "@/server/modules/eval/stats";
import { reviewContent } from "@/server/modules/eval-review/content";
import { reviewVerdictInput } from "@/server/modules/eval-review/schemas";
import { isReviewer, nextUnreviewed, reviewEnabled } from "@/server/modules/eval-review/service";
import { EnvValidationError, parseEnv, resetEnvCache } from "@/server/platform/env";

/** The M6 evaluation Review page (D2): sampling, content, hashing, export and access rules. */

describe("Wilson score interval (M6 D3)", () => {
  // Reference values computed independently (Python, z = 1.959964), also quoted in the plan.
  it.each([
    [18, 20, 0.699, 0.972],
    [132, 150, 0.818, 0.923],
    [13, 20, 0.433, 0.819],
  ])("%i/%i gives %f–%f", (k, n, low, high) => {
    const r = wilson(k, n);
    expect(r.rate).toBeCloseTo(k / n, 10);
    expect(r.low).toBeCloseTo(low, 3);
    expect(r.high).toBeCloseTo(high, 3);
  });

  it("stays inside 0–1 at the extremes and is null without data", () => {
    expect(wilson(0, 10).low).toBe(0);
    expect(wilson(10, 10).high).toBe(1);
    expect(wilson(0, 10).high).toBeGreaterThan(0); // never claims certainty from 10 items
    expect(wilson(0, 0)).toEqual({ successes: 0, n: 0, rate: null, low: null, high: null });
  });

  it("rejects impossible counts", () => {
    for (const [k, n] of [
      [3, 2],
      [-1, 5],
      [1.5, 4],
    ] as const) {
      expect(() => wilson(k, n)).toThrow(RangeError);
    }
  });

  it("formats a rate with its interval and sample size", () => {
    expect(formatRate(wilson(18, 20))).toBe("90% (70–97%, n=20)");
    expect(formatRate(wilson(0, 0))).toBe("no data");
  });
});

describe("rubric rules in code match docs/eval/triage-rubric.md", () => {
  it("lists the same rules, in the same order, with the same priorities", () => {
    const doc = readFileSync("docs/eval/triage-rubric.md", "utf8");
    const rows = [...doc.matchAll(/^\| \*\*([UHNL]\d)\*\* +\| \*\*(\w+)\*\*/gm)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual(RUBRIC_RULE_IDS.map((id) => [id, RUBRIC_RULES[id].priority]));
  });
});

describe("review sample (mechanical, 20%)", () => {
  it("takes every 5th item", () => {
    expect(everyFifth([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([5, 10]);
  });

  it("samples 30 of the 150 triage tickets: 5 demo and 25 new", () => {
    const keys = triageLabelItems().map((i) => i.itemKey);
    expect(keys).toHaveLength(30);
    expect(keys.slice(0, 5)).toEqual(["nim-05", "nim-10", "nim-15", "nim-20", "nim-25"]);
    expect(keys.slice(5)).toEqual(
      Array.from({ length: 25 }, (_, i) => `tri-${String((i + 1) * 5).padStart(3, "0")}`),
    );
  });

  it("samples the same 22 help-centre questions as docs/eval/label-spot-check.md", () => {
    const doc = readFileSync("docs/eval/label-spot-check.md", "utf8");
    const listed = [...doc.matchAll(/^### (q\d{3}):/gm)].map((m) => m[1]);
    expect(retrievalLabelItems().map((i) => i.itemKey)).toEqual(listed);
  });

  it("keeps the AI spot-check record in step with the sample, labelled as an AI check", () => {
    const record = JSON.parse(readFileSync("eval/review/ai-check-2026-10-23.json", "utf8")) as {
      checkedBy: string;
      items: { set: string; key: string; verdict: string; note: string | null }[];
    };
    expect(record.checkedBy).toMatch(/^AI assistant.*NOT a human review/);
    const sample = [...triageLabelItems(), ...retrievalLabelItems()].map((i) => [i.set, i.itemKey]);
    expect(record.items.map((i) => [i.set, i.key])).toEqual(sample);
    for (const i of record.items) {
      expect(["agree", "disagree", "unclear"]).toContain(i.verdict);
      if (i.verdict !== "agree") expect(i.note?.length ?? 0, i.key).toBeGreaterThan(40); // every finding is explained
    }
  });

  it("has no label changes left to ask about once every decision is applied", () => {
    expect(labelChangeItems()).toEqual([]);
    expect(loadDemoLabelFile().labels.filter((l) => l.review)).toHaveLength(7);
  });

  it("asks one question per item: labels and wording separately", () => {
    const [nim16] = loadDemoLabelFile().labels.filter((l) => l.key === "nim-16");
    const proposal = {
      ...nim16!,
      expected: { ...nim16!.expected, priority: "urgent" as const },
      rule: "U2" as const,
      change: "priority high → urgent: test proposal.",
      proposedMessage: "I downgraded two weeks ago and was charged the old price at renewal.",
    };
    const nim07 = {
      ...loadDemoLabelFile().labels.find((l) => l.key === "nim-07")!,
      proposedMessage: "Uploads over 2 GB fail at 99% in Chrome.",
    };
    const items = labelChangeItems([proposal, nim07]);
    expect(items.map((i) => [i.itemKey, i.content.question])).toEqual([
      ["nim-16-labels", "Approve the new labels?"],
      ["nim-16-wording", "Approve the new wording?"],
      ["nim-07-wording", "Approve the new wording?"],
    ]);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    const labels = items[0]!.content.fields.map((f) => f.label);
    expect(labels).toEqual(["Customer's message", "Current labels", "Proposed labels", "Why"]);
    expect(items[0]!.content.fields[2]!.value).toBe(
      "billing · urgent (rule U2: Data being lost now, or the trash period ends within 7 days)",
    );
    expect(items[1]!.content.fields.map((f) => f.label)).toEqual([
      "Customer's message",
      "Proposed wording",
      "Why",
    ]);
  });

  it("shows the rule behind each triage priority and the reference answer for each question", () => {
    const triage = triageLabelItems()[0]!;
    expect(triage.content.fields.find((f) => f.label === "Priority")?.value).toMatch(/\(rule [UHNL]\d: /);
    const retrieval = retrievalLabelItems()[0]!;
    expect(retrieval.content.fields.map((f) => f.label)).toEqual([
      "Article",
      "Answer passage",
      "Reference answer",
    ]);
  });

  it("builds valid, uniquely keyed items in page order", () => {
    const items = buildReviewItems();
    expect(items).toHaveLength(30 + 22);
    expect(new Set(items.map((i) => `${i.set}/${i.itemKey}`)).size).toBe(items.length);
    for (const i of items) {
      expect(reviewContent.parse(i.content)).toEqual(i.content);
      expect(i.itemKey).toMatch(/^[a-z0-9-]{1,40}$/); // the database's own check
    }
    for (const set of ["label-changes", "triage-labels", "retrieval-labels"]) {
      const positions = items.filter((i) => i.set === set).map((i) => i.position);
      expect(positions).toEqual(positions.map((_, n) => n + 1));
    }
  });
});

describe("content hash (what the reviewer saw)", () => {
  const content = reviewContent.parse({
    title: "A ticket",
    fields: [{ label: "Message", value: "Hello there", kind: "quote" }],
    question: "Is this right?",
  });

  it("is a stable SHA-256 that doesn't depend on property order", () => {
    const reordered = {
      disagreeLabel: content.disagreeLabel,
      agreeLabel: content.agreeLabel,
      question: content.question,
      fields: content.fields.map((f) => ({ kind: f.kind, value: f.value, label: f.label })),
      title: content.title,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(content));
    expect(contentHash(content)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(reordered)).toBe(contentHash(content));
    expect(buildReviewItems().map((i) => i.contentHash)).toEqual(
      buildReviewItems().map((i) => i.contentHash),
    );
  });

  it("changes when anything the reviewer sees changes", () => {
    const edited = { ...content, fields: [{ ...content.fields[0]!, value: "Hello there!" }] };
    expect(contentHash(edited)).not.toBe(contentHash(content));
    expect(contentHash({ ...content, agreeLabel: "Approve" })).not.toBe(contentHash(content));
  });

  it("content rejects unknown fields and fills the default button labels", () => {
    expect(content.agreeLabel).toBe("Yes, correct");
    expect(reviewContent.safeParse({ ...content, html: "<b>x</b>" }).success).toBe(false);
  });
});

describe("verdict input", () => {
  const hash = "a".repeat(64);

  it("trims the note, treats an empty one as none, and caps it at 500 characters", () => {
    expect(reviewVerdictInput.parse({ contentHash: hash, verdict: "agree", note: "  ok  " }).note).toBe("ok");
    expect(reviewVerdictInput.parse({ contentHash: hash, verdict: "agree", note: "   " }).note).toBeNull();
    expect(
      reviewVerdictInput.safeParse({ contentHash: hash, verdict: "agree", note: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("gives the same result when parsed twice (route, then service)", () => {
    const once = reviewVerdictInput.parse({ contentHash: hash, verdict: "disagree" });
    expect(reviewVerdictInput.parse(once)).toEqual(once);
  });

  it("rejects other verdicts, bad hashes and extra fields", () => {
    expect(reviewVerdictInput.safeParse({ contentHash: hash, verdict: "maybe" }).success).toBe(false);
    expect(reviewVerdictInput.safeParse({ contentHash: "abc", verdict: "agree" }).success).toBe(false);
    expect(reviewVerdictInput.safeParse({ contentHash: hash, verdict: "agree", userId: "x" }).success).toBe(
      false,
    );
  });
});

describe("next item to review", () => {
  const outline = (verdicts: (string | null)[]) =>
    verdicts.map((v, i) => ({ id: String(i), itemKey: `k${i}`, verdict: v as "agree" | null }));

  it("finds the next unchecked item after the current one, wrapping around", () => {
    expect(nextUnreviewed(outline(["agree", null, null]), 0)).toBe("k1");
    expect(nextUnreviewed(outline([null, "agree", "agree"]), 2)).toBe("k0");
  });

  it("returns null when everything is checked, and never returns the current item", () => {
    expect(nextUnreviewed(outline(["agree", "agree"]), 0)).toBeNull();
    expect(nextUnreviewed(outline([null]), 0)).toBe("k0"); // a lone item still needs its answer
  });
});

describe("review export file", () => {
  const at = new Date("2026-10-24T10:00:00Z");
  const rows = [
    { itemKey: "q005", contentHash: "a".repeat(64), verdict: "agree" as const, note: null, reviewedAt: at },
    {
      itemKey: "q010",
      contentHash: "b".repeat(64),
      verdict: "disagree" as const,
      note: "Too vague",
      reviewedAt: at,
    },
    { itemKey: "q015", contentHash: "c".repeat(64), verdict: null, note: null, reviewedAt: null },
  ];

  it("reports agreement with its interval, counting only checked items", () => {
    const out = summariseReview("retrieval-labels", rows);
    expect([out.total, out.reviewed, out.agreed]).toEqual([3, 2, 1]);
    expect(out.agreement.rate).toBe(0.5);
    expect(out.summary).toBe("2 of 3 checked; marked correct: 50% (9–91%, n=2); 1 still to check");
  });

  it("records decisions and notes, but no reviewer identity", () => {
    const out = summariseReview("retrieval-labels", rows);
    expect(Object.keys(out.items[0]!).sort()).toEqual([
      "contentHash",
      "key",
      "note",
      "reviewedAt",
      "verdict",
    ]);
    expect(out.items[1]).toMatchObject({ key: "q010", verdict: "disagree", note: "Too vague" });
  });
});

describe("who can review (EVAL_REVIEWER_EMAILS)", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
  };

  const saved = Object.fromEntries(Object.keys(base).map((k) => [k, process.env[k]]));
  afterEach(() => {
    delete process.env.EVAL_REVIEWER_EMAILS;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  });

  it("is off by default", () => {
    expect(parseEnv(base).EVAL_REVIEWER_EMAILS).toEqual([]);
  });

  it("parses a comma-separated list, trimmed and lower-cased", () => {
    expect(
      parseEnv({ ...base, EVAL_REVIEWER_EMAILS: " Owner@Example.com, ,b@example.com " }).EVAL_REVIEWER_EMAILS,
    ).toEqual(["owner@example.com", "b@example.com"]);
  });

  it("rejects entries that aren't email addresses", () => {
    expect(() => parseEnv({ ...base, EVAL_REVIEWER_EMAILS: "owner@example.com,*" })).toThrow(
      EnvValidationError,
    );
  });

  it("matches addresses exactly, ignoring case, and denies everyone when the list is empty", () => {
    Object.assign(process.env, base, { EVAL_REVIEWER_EMAILS: "owner@example.com" });
    resetEnvCache();
    expect(reviewEnabled()).toBe(true);
    expect(isReviewer("OWNER@example.com")).toBe(true);
    expect(isReviewer("owner@example.com.evil.test")).toBe(false);
    expect(isReviewer("other@example.com")).toBe(false);
    expect(isReviewer("")).toBe(false);
    expect(isReviewer(null)).toBe(false);

    delete process.env.EVAL_REVIEWER_EMAILS;
    resetEnvCache();
    expect(reviewEnabled()).toBe(false);
    expect(isReviewer("owner@example.com")).toBe(false);
  });
});

describe("internal review endpoint", () => {
  it("lives under /api/internal and stays out of the public API and its OpenAPI document", () => {
    const doc = buildOpenApiDocument();
    const publicIds = new Set(Object.keys(operations));
    for (const op of Object.values(internalOperations)) {
      expect(op.path.startsWith("/api/internal/")).toBe(true);
      expect(op.tag).toBe("Internal");
      expect(publicIds.has(op.id)).toBe(false);
      expect(Object.keys(doc.paths).some((path) => path.startsWith("/api/internal"))).toBe(false);
      expect(JSON.stringify(doc)).not.toContain(op.id);
    }
  });
});
