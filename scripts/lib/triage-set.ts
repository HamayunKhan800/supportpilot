/**
 * The M6 triage evaluation set: the 25 demo tickets (text in the demo seed, labels in
 * eval/triage/demo-labels.json) plus 125 written for M6 (eval/triage/tickets.json). Every
 * label follows docs/eval/triage-rubric.md and names the rubric rule that set its priority.
 * Shared by the eval runner, the review loader and the dataset tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { DEMO_TICKETS } from "../../src/server/modules/tickets/demo/tickets";
import { TICKET_PRIORITIES } from "../../src/server/modules/tickets/types";
import { DEFAULT_CATEGORIES } from "../../src/server/platform/auth/workspace-settings";
import { SENTIMENTS } from "../../src/server/platform/db/schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const TRIAGE_TICKETS_FILE = path.join(ROOT, "eval/triage/tickets.json");
export const DEMO_LABELS_FILE = path.join(ROOT, "eval/triage/demo-labels.json");

/** Priority rules in docs/eval/triage-rubric.md, and the priority each one sets. */
export const RUBRIC_RULES = {
  U1: "urgent",
  U2: "urgent",
  U3: "urgent",
  H1: "high",
  H2: "high",
  H3: "high",
  N1: "normal",
  N2: "normal",
  L1: "low",
  L2: "low",
} as const;
export type RubricRule = keyof typeof RUBRIC_RULES;

/** Languages the set covers (ISO 639-1). Roman Urdu is labelled `ur`, as the rubric says. */
export const SET_LANGUAGES = ["en", "es", "ur", "fr", "de", "pt", "ar"] as const;

const expected = z.strictObject({
  category: z.enum(DEFAULT_CATEGORIES as unknown as [string, ...string[]]),
  priority: z.enum(TICKET_PRIORITIES),
  sentiment: z.enum(SENTIMENTS),
  language: z.enum(SET_LANGUAGES),
});
const rule = z.enum(Object.keys(RUBRIC_RULES) as [RubricRule, ...RubricRule[]]);

/** The rule must be the one that sets the labelled priority. */
const ruleMatchesPriority = (t: { rule: RubricRule; expected: { priority: string } }) =>
  RUBRIC_RULES[t.rule] === t.expected.priority;
const ruleError = { error: "the rule doesn't set this priority", path: ["rule"] };

const TAGS = [
  "typo",
  "terse",
  "long",
  "angry",
  "sarcastic",
  "polite",
  "positive",
  "multi-issue",
  "vague",
  "ambiguous",
  "misleading-keyword",
  "claims-urgent",
  "claims-no-rush",
  "non-english",
  "roman-urdu",
  "mixed-language",
] as const;

const ticketsSchema = z.strictObject({
  rubric: z.string().min(1),
  about: z.string().min(1),
  tickets: z
    .array(
      z
        .strictObject({
          key: z.string().regex(/^tri-\d{3}$/),
          subject: z.string().trim().min(3).max(200),
          message: z.string().trim().min(10).max(10_000),
          expected,
          rule,
          tags: z.array(z.enum(TAGS)),
          note: z.string().min(5).optional(),
        })
        .refine(ruleMatchesPriority, ruleError),
    )
    .min(1),
});

const demoLabelsSchema = z.strictObject({
  rubric: z.string().min(1),
  status: z.string().min(1),
  dataIssues: z.array(z.string()),
  labels: z
    .array(
      z
        .strictObject({
          key: z.string().regex(/^nim-\d{2}$/),
          expected,
          rule,
          /** A label change proposed under the rubric, waiting for the owner's review. */
          change: z.string().min(5).optional(),
          /** Proposed rewording (wrong plan names), waiting for the owner's review. */
          proposedSubject: z.string().trim().min(3).max(200).optional(),
          proposedMessage: z.string().trim().min(10).max(10_000).optional(),
        })
        .refine(ruleMatchesPriority, ruleError),
    )
    .min(1),
});

export type TriageTicketFile = z.infer<typeof ticketsSchema>;
export type DemoLabelsFile = z.infer<typeof demoLabelsSchema>;
export type DemoLabel = DemoLabelsFile["labels"][number];

export interface TriageSetItem {
  key: string;
  source: "demo" | "m6";
  subject: string;
  message: string;
  expected: z.infer<typeof expected>;
  rule: RubricRule;
  tags: readonly string[];
  note?: string;
}

export function loadTriageTicketFile(file = TRIAGE_TICKETS_FILE): TriageTicketFile {
  return ticketsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function loadDemoLabelFile(file = DEMO_LABELS_FILE): DemoLabelsFile {
  return demoLabelsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** All 150 tickets in a fixed order: the demo tickets first, then the M6 ones. */
export function loadTriageSet(): TriageSetItem[] {
  const labels = new Map(loadDemoLabelFile().labels.map((l) => [l.key, l]));
  const demo = DEMO_TICKETS.map((t): TriageSetItem => {
    const l = labels.get(t.key);
    if (!l) throw new Error(`${t.key} has no entry in demo-labels.json`);
    return {
      key: t.key,
      source: "demo",
      subject: t.subject,
      message: t.message,
      expected: l.expected,
      rule: l.rule,
      tags: [],
      ...(t.note ? { note: t.note } : {}),
    };
  });
  const m6 = loadTriageTicketFile().tickets.map((t): TriageSetItem => ({ ...t, source: "m6" }));
  return [...demo, ...m6];
}
