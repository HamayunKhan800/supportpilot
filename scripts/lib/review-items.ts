/**
 * Builds the items for the evaluation Review page (M6 D2) from the dataset files. The
 * samples are chosen mechanically (every 5th item, i.e. 20%), never by hand, so the check
 * can't be steered towards easy cases. AI drafts are added in step 3, once they exist.
 */
import { createHash } from "node:crypto";

import { RUBRIC_RULES } from "../../src/server/modules/eval/rubric";
import {
  reviewContent,
  type ReviewContent,
  type ReviewContentInput,
  type ReviewSet,
} from "../../src/server/modules/eval-review/content";
import type { ReviewItemSeed } from "../../src/server/modules/eval-review/repository";
import { DEMO_TICKETS } from "../../src/server/modules/tickets/demo/tickets";
import { loadCorpus, loadQuestions, type CorpusArticle, type EvalQuestion } from "./kb-corpus";
import { loadDemoLabelFile, loadTriageSet, type DemoLabel, type TriageSetItem } from "./triage-set";

export type { ReviewItemSeed };

/** Every 5th item (the 5th, 10th, ...): a mechanical 20% sample. */
export const everyFifth = <T>(items: readonly T[]): T[] => items.filter((_, i) => (i + 1) % 5 === 0);

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ur: "Urdu",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
};

/** JSON with sorted keys, so the hash doesn't depend on property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const contentHash = (content: ReviewContent) =>
  createHash("sha256").update(canonical(content)).digest("hex");

function seed(set: ReviewSet, itemKey: string, position: number, input: ReviewContentInput): ReviewItemSeed {
  const content = reviewContent.parse(input);
  return { set, itemKey, position, content, contentHash: contentHash(content) };
}

const ruleText = (rule: keyof typeof RUBRIC_RULES) => `rule ${rule}: ${RUBRIC_RULES[rule].summary}`;

export function labelChangeItems(
  labels: readonly DemoLabel[] = loadDemoLabelFile().labels,
): ReviewItemSeed[] {
  const tickets = new Map(DEMO_TICKETS.map((t) => [t.key, t]));
  const items: ReviewItemSeed[] = [];
  // One question per item: a label change and a rewording of the same ticket are asked
  // separately, so one tap never has to answer two questions (finding #101).
  for (const l of labels) {
    if (!l.change && !l.proposedMessage) continue;
    const t = tickets.get(l.key);
    if (!t) throw new Error(`${l.key} is not a demo ticket`);
    const message = { label: "Customer's message", value: t.message, kind: "quote" } as const;
    const current = { label: "Current labels", value: `${t.expected.category} · ${t.expected.priority}` };
    if (l.change) {
      items.push(
        seed("label-changes", `${l.key}-labels`, items.length + 1, {
          title: `${l.key}: ${t.subject}`,
          fields: [
            message,
            current,
            {
              label: "Proposed labels",
              value: `${l.expected.category} · ${l.expected.priority} (${ruleText(l.rule)})`,
            },
            { label: "Why", value: l.change },
          ],
          question: "Approve the new labels?",
          agreeLabel: "Approve",
          disagreeLabel: "Keep the old labels",
        }),
      );
    }
    if (l.proposedMessage) {
      items.push(
        seed("label-changes", `${l.key}-wording`, items.length + 1, {
          title: `${l.key}: ${t.subject}`,
          fields: [
            message,
            { label: "Proposed wording", value: l.proposedMessage, kind: "quote" },
            {
              label: "Why",
              value:
                "The message names a plan that doesn't exist in the help articles (they have Free, Personal, Family and Business). The new wording uses a real plan and asks the same thing.",
            },
          ],
          question: "Approve the new wording?",
          agreeLabel: "Approve",
          disagreeLabel: "Keep the old wording",
        }),
      );
    }
  }
  return items;
}

export function triageLabelItems(set: readonly TriageSetItem[] = loadTriageSet()): ReviewItemSeed[] {
  return everyFifth(set).map((t, i) =>
    seed("triage-labels", t.key, i + 1, {
      title: t.subject,
      fields: [
        { label: "Message", value: t.message, kind: "quote" },
        { label: "Category", value: t.expected.category },
        { label: "Priority", value: `${t.expected.priority} (${ruleText(t.rule)})` },
        { label: "Sentiment", value: t.expected.sentiment },
        { label: "Language", value: `${LANGUAGE_NAMES[t.expected.language] ?? t.expected.language}` },
        ...(t.note ? [{ label: "Label note", value: t.note }] : []),
      ],
      question: "Do these labels follow the rubric?",
    }),
  );
}

export function retrievalLabelItems(
  questions: readonly EvalQuestion[] = loadQuestions(),
  corpus: readonly Pick<CorpusArticle, "file" | "title">[] = loadCorpus(),
): ReviewItemSeed[] {
  const titles = new Map(corpus.map((a) => [a.file, a.title]));
  return everyFifth(questions).map((q, i) => {
    const title = titles.get(q.article);
    if (!title) throw new Error(`${q.id}: unknown article ${q.article}`);
    return seed("retrieval-labels", q.id, i + 1, {
      title: q.question,
      fields: [
        { label: "Article", value: title },
        { label: "Answer passage", value: q.evidence, kind: "quote" },
        { label: "Reference answer", value: q.reference, kind: "quote" },
      ],
      question: "Would a customer ask this, and do the passage and the reference answer correctly answer it?",
    });
  });
}

/** Everything the Review page shows today, in page order. */
export function buildReviewItems(): ReviewItemSeed[] {
  return [...labelChangeItems(), ...triageLabelItems(), ...retrievalLabelItems()];
}
