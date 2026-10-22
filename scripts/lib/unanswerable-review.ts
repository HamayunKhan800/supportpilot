/**
 * The human check that the unanswerable questions really are unanswerable: each question
 * with the passages vector and keyword search found for it, as a Markdown page.
 */
import type { UnanswerableQuestion } from "./kb-corpus";
import type { ConfigResult, EvalReport, FoundPassage } from "./retrieval-eval";

const PREVIEW_CHARS = 240;
/** Per search type: enough to judge on a phone (the eval itself keeps the top 5). */
const SHOWN_PER_SEARCH = 3;

const preview = (text: string) => {
  const flat = text.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS).trimEnd()}…` : flat;
};

const where = (p: FoundPassage) => (p.headingPath ? `${p.article} › ${p.headingPath}` : p.article);

export function formatUnanswerableReview(
  report: EvalReport,
  config: ConfigResult,
  questions: readonly UnanswerableQuestion[],
  generatedAt: string,
): string {
  const result = config.unanswerable;
  if (!result) throw new Error("This configuration has no unanswerable results");
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lines = [
    "# Unanswerable questions: human check",
    "",
    `Generated ${generatedAt} by \`pnpm eval:retrieval\` (${report.model}, chunks ${config.chunk.targetTokens} tokens / ${config.chunk.overlapRatio} overlap). Do not edit by hand.`,
    "",
    "These questions are meant to have **no answer** in the 35 Nimbus help articles, so the AI should say it doesn't know (refusal tests, M5/M6). A question wrongly marked unanswerable would punish a correct answer, so each one is checked three ways:",
    "",
    "1. **Word check (automatic):** the terms an answer would need appear in no article (unit test).",
    `2. **Search check (automatic):** below are the top ${SHOWN_PER_SEARCH} passages from meaning (vector) search and from keyword search (repeats shown once, text shortened).`,
    "3. **Human check (you):** read each question and its passages. **If any passage answers the question, note the question id** (e.g. u007). Partly answering counts too.",
    "",
    `**Best vector match score** (1 = identical meaning): answerable questions ${result.answerableTop1.min}–${result.answerableTop1.max} (median ${result.answerableTop1.p50}); unanswerable ${result.unanswerableTop1.min}–${result.unanswerableTop1.max} (median ${result.unanswerableTop1.p50}). Where the ranges overlap, a score cut-off alone can't tell them apart.`,
    "",
  ];
  for (const found of result.questions) {
    const q = byId.get(found.id);
    if (!q) throw new Error(`Unknown unanswerable question ${found.id}`);
    lines.push(`## ${q.id}: ${q.question}`, "", `**Why it should be unanswerable:** ${q.why}`, "");
    const seen = new Set<string>();
    let n = 0;
    for (const p of found.vector.slice(0, SHOWN_PER_SEARCH)) {
      seen.add(`${p.article}\u0000${p.content}`);
      lines.push(`${++n}. **${where(p)}** (vector, score ${p.similarity}): ${preview(p.content)}`);
    }
    for (const p of found.keyword.slice(0, SHOWN_PER_SEARCH)) {
      if (seen.has(`${p.article}\u0000${p.content}`)) continue;
      seen.add(`${p.article}\u0000${p.content}`);
      lines.push(`${++n}. **${where(p)}** (keyword): ${preview(p.content)}`);
    }
    if (found.keyword.length === 0) lines.push("", "_Keyword search found nothing._");
    lines.push("");
  }
  return lines.join("\n");
}

/** The saved JSON keeps where each passage came from and its score, not its text. */
export function withoutPassageText(report: EvalReport): EvalReport {
  return {
    ...report,
    configs: report.configs.map((c) =>
      c.unanswerable
        ? {
            ...c,
            unanswerable: {
              ...c.unanswerable,
              questions: c.unanswerable.questions.map((q) => ({
                id: q.id,
                vector: q.vector.map((p) => ({ ...p, content: "" })),
                keyword: q.keyword.map((p) => ({ ...p, content: "" })),
              })),
            },
          }
        : c,
    ),
  };
}
