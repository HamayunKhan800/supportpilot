import { z } from "zod";

import triageSet from "../../../../eval/triage/tickets.json";
import corpus from "../../../../eval/corpus/nimbus/manifest.json";
import retrievalSet from "../../../../eval/retrieval/questions.json";
import { DEMO_TICKETS } from "../tickets/demo/tickets";
import type { EvalSuite } from "./constants";
import type { EvalMissRow } from "./repository";

/**
 * "What it got wrong" on the evaluation dashboard (after the example views in Braintrust and
 * Langfuse): each item the headline run missed, with what was expected and what the AI did.
 * Stored results are JSON from whichever version of `pnpm eval` ran, so each is validated here and
 * an item that doesn't parse is counted but not shown. Ticket subjects and questions come from the
 * fixed, synthetic test sets in eval/ (no customer data), matched by key; article files are shown by
 * their title from the corpus manifest.
 */

export interface Miss {
  key: string;
  /** The ticket subject or question, when the test set still has the key. */
  what: string;
  expected: string;
  got: string;
}

export interface MissGroup {
  suite: EvalSuite;
  title: string;
  items: Miss[];
  /** Items that were stored but couldn't be read (an older result format). */
  unreadable: number;
}

const text = z.string().max(2000);
const label = z.string().max(80);

const TriageMiss = z.object({
  key: label,
  expected: z.object({ category: label, priority: label }),
  got: z.object({ category: label, priority: label }).nullable(),
  status: label,
});
const RetrievalMiss = z.object({ id: label, retrieved: z.array(label).max(10) });
const DraftMiss = z.object({
  id: label,
  set: z.enum(["answerable", "unanswerable"]),
  question: text,
  goldArticle: label.nullable(),
  status: label,
  citedTitles: z.array(z.string().max(200)).max(20),
});
const InjectionMiss = z.object({
  id: label,
  technique: label,
  target: label,
  signs: z.array(z.string().max(200)).max(20),
});

const subjects = new Map<string, string>([
  ...DEMO_TICKETS.map((t): [string, string] => [t.key, t.subject]),
  ...triageSet.tickets.map((t): [string, string] => [t.key, t.subject]),
]);
const questions = new Map(retrievalSet.questions.map((q) => [q.id, q]));
const titles = new Map(corpus.articles.map((a) => [a.file, a.title]));
/** "account-recovery.md" -> "Recover a locked account", as the app shows it; else the file name. */
const title = (file: string) => titles.get(file) ?? file;

const cited = (titles: string[]) => (titles.length ? `citing ${titles.join("; ")}` : "with no citation");

function draftOutcome(r: z.infer<typeof DraftMiss>): { expected: string; got: string } {
  const got =
    r.status === "ready"
      ? `Answered, ${cited(r.citedTitles)}`
      : r.status === "refused"
        ? "Declined to answer"
        : `Ended as "${r.status}"`;
  return r.set === "unanswerable"
    ? { expected: "Decline: the knowledge base has no answer", got }
    : { expected: `Answer citing ${r.goldArticle ? title(r.goldArticle) : "the right article"}`, got };
}

function parse(row: EvalMissRow): Miss | null {
  const r = row.result;
  switch (row.suite) {
    case "triage": {
      const p = TriageMiss.safeParse(r);
      if (!p.success) return null;
      return {
        key: p.data.key,
        what: subjects.get(p.data.key) ?? p.data.key,
        expected: `${p.data.expected.category} · ${p.data.expected.priority}`,
        got: p.data.got ? `${p.data.got.category} · ${p.data.got.priority}` : `No answer (${p.data.status})`,
      };
    }
    case "retrieval": {
      const p = RetrievalMiss.safeParse(r);
      if (!p.success) return null;
      const q = questions.get(p.data.id);
      return {
        key: p.data.id,
        what: q?.question ?? p.data.id,
        expected: q ? title(q.article) : "the article holding the answer",
        // One entry per matching passage, so an article can repeat: show each once.
        got: p.data.retrieved.length
          ? `Top results: ${[...new Set(p.data.retrieved)].slice(0, 3).map(title).join("; ")}`
          : "No results",
      };
    }
    case "draft": {
      const p = DraftMiss.safeParse(r);
      if (!p.success) return null;
      return { key: p.data.id, what: p.data.question, ...draftOutcome(p.data) };
    }
    case "injection": {
      const p = InjectionMiss.safeParse(r);
      if (!p.success) return null;
      return {
        key: p.data.id,
        what: `${p.data.technique} (${p.data.target})`,
        expected: "Ignore the attack",
        got: p.data.signs.length ? `Obeyed: ${p.data.signs.join("; ")}` : "Obeyed",
      };
    }
    default:
      return null;
  }
}

const GROUPS: { suite: EvalSuite; title: string }[] = [
  { suite: "triage", title: "Triage: wrong category" },
  { suite: "retrieval", title: "Knowledge search: right article not in the top 5" },
  { suite: "draft", title: "Drafts: wrong outcome" },
  { suite: "injection", title: "Safety: attacks the AI obeyed" },
];

/** The misses grouped by test set, in the report's order; empty groups are left out. */
export function missGroups(rows: readonly EvalMissRow[]): MissGroup[] {
  return GROUPS.flatMap(({ suite, title }) => {
    const mine = rows.filter((r) => r.suite === suite);
    if (mine.length === 0) return [];
    const items = mine.map(parse).filter((m): m is Miss => m !== null);
    return [{ suite, title, items, unreadable: mine.length - items.length }];
  });
}
