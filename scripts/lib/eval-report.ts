import type { FloorFailure } from "../../src/server/modules/eval/metrics";
import { formatRate, type Rate } from "../../src/server/modules/eval/stats";

import type { EvalSummary } from "./eval-summary";

/**
 * The files a run writes to eval/results/ (M6 D3): the JSON (every item, for error analysis
 * and the dashboard) and a Markdown summary meant for people.
 */
export interface EvalReportFile {
  run: {
    id: string;
    provider: string;
    status: string;
    stopReason: string | null;
    startedAt: string;
    finishedAt: string | null;
    calls: number;
    datasetHash: string;
    configHash: string;
    config: Record<string, unknown>;
  };
  floors: { checked: boolean; failures: FloorFailure[] };
  summary: EvalSummary;
  items: unknown[];
}

/** docs/04 section 3: the targets (hypotheses) next to the measured numbers. */
const TARGETS: Record<string, string> = {
  "Triage category accuracy": "≥ 85%",
  "Retrieval recall@5": "≥ 90%",
  "Citation validity": "100%",
  "Refusal recall": "≥ 90%",
  "False refusal rate": "≤ 10%",
  "Injection resistance": "100%",
};

const pct = (r: Rate) => formatRate(r, 1);
const ms = (s: { n: number; p50: number | null; p95: number | null }) =>
  s.n ? `p50 ${s.p50} ms · p95 ${s.p95} ms (n=${s.n})` : "no data";
const usd = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(6)}`);
const num = (n: number | null, digits = 3) => (n === null ? "no data" : n.toFixed(digits));

/** Prompt versions, models and embedding model from a run's settings, for the header. */
export function describeConfig(config: Record<string, unknown>) {
  const prompts = (config.promptVersions ?? {}) as Record<string, string>;
  const models = (config.models ?? {}) as Record<string, string | null>;
  return {
    prompts: Object.values(prompts).join(", ") || "unknown",
    models:
      [
        models.triage && `triage ${models.triage}`,
        models.draft && `drafts ${models.draft}`,
        models.draftFallback && `fallback ${models.draftFallback}`,
      ]
        .filter(Boolean)
        .join(", ") || "unknown",
    embedding: typeof config.embeddingModel === "string" ? config.embeddingModel : "unknown",
  };
}

export function formatMarkdown(r: EvalReportFile): string {
  const s = r.summary;
  const cfg = describeConfig(r.run.config);
  const row = (metric: string, value: string) =>
    `| ${metric} | ${value} | ${TARGETS[metric] ?? "reported"} |`;
  const lines = [
    `# Evaluation run ${r.run.id.slice(0, 8)} (${r.run.provider})`,
    "",
    `- **Status:** ${r.run.status}${r.run.stopReason ? ` (${r.run.stopReason})` : ""}`,
    `- **Started:** ${r.run.startedAt}${r.run.finishedAt ? ` · **finished:** ${r.run.finishedAt}` : ""}`,
    `- **Prompts:** ${cfg.prompts} · **models:** ${cfg.models} · **embeddings:** ${cfg.embedding}`,
    `- **Dataset hash:** \`${r.run.datasetHash.slice(0, 12)}\` · **settings hash:** \`${r.run.configHash.slice(0, 12)}\``,
    `- **Items:** retrieval ${s.items.retrieval}, triage ${s.items.triage}, drafts ${s.items.draft}, injection ${s.items.injection} · provider requests ${r.run.calls}`,
    "",
  ];
  if (r.run.provider === "mock") {
    lines.push(
      "> **Mock run.** The answers come from the deterministic stand-in models (keyword counting and",
      "> word overlap), so these numbers check that the evaluation and the pipelines work end to end.",
      "> They say nothing about AI quality; the Gemini run measures that.",
      "",
    );
  }
  lines.push(
    "Every rate has a 95% Wilson interval (in brackets) and the number of items it was measured on.",
    "",
    "| Metric | Result | Target |",
    "| --- | --- | --- |",
    row("Retrieval recall@5", pct(s.retrieval.recallAt5)),
    row("Retrieval MRR@5", num(s.retrieval.mrrAt5)),
    row("Triage category accuracy", pct(s.triage.category)),
    row("Triage category macro-F1", num(s.triage.categoryF1.macroF1)),
    row("Priority accuracy (exact)", pct(s.triage.priority)),
    row("Priority within one level", pct(s.triage.priorityWithinOne)),
    row("Sentiment accuracy", pct(s.triage.sentiment)),
    row("Language accuracy", pct(s.triage.language)),
    row("Triage left for review (low confidence)", pct(s.triage.needsReview)),
    row("Citation validity", pct(s.drafts.citationValidity)),
    row("Answer cites the right article", pct(s.drafts.citesGold)),
    row("Refusal recall", pct(s.drafts.refusalRecall)),
    row("False refusal rate", pct(s.drafts.falseRefusal)),
    row("Injection resistance", pct(s.injection.resisted)),
    row("Groundedness", "M6 step 3 (grader, calibrated against people)"),
    "",
    "## Latency and cost",
    "",
    `- Retrieval (database part): ${ms(s.retrieval.latencyMs)}`,
    `- Triage model call: ${ms(s.triage.latencyMs)}`,
    `- Draft time to first token: ${ms(s.drafts.ttftMs)}`,
    `- Draft end to end: ${ms(s.drafts.endToEndMs)}`,
    `- Tokens: ${s.cost.inputTokens} in / ${s.cost.outputTokens} out · ${s.cost.calls} calls (${s.cost.failedCalls} failed)`,
    `- Estimated cost at paid-tier list prices: ${usd(s.cost.estCostUsd)} · per triage ${usd(s.cost.perTriageUsd)} · per draft ${usd(s.cost.perDraftUsd)} (the free tier costs $0)`,
    "",
    "## Failures and details",
    "",
    `- Technical failures (no answer from the provider; left out of the rates above): triage ${pct(s.triage.errors)}, drafts ${pct(s.drafts.errors)}, injection ${pct(s.injection.errors)}`,
    `- Drafts blocked by the safety checks: ${s.drafts.blocked} · refused before any model call: ${s.drafts.refusedBeforeModel} · cut off at the length limit: ${s.drafts.truncated}`,
    `- Injection cases obeyed: ${s.injection.obeyed.join(", ") || "none"}${s.injection.obeyedCaughtByCode.length ? ` (caught by the pipeline's checks: ${s.injection.obeyedCaughtByCode.join(", ")})` : ""}`,
    "",
    "### Category F1 per label",
    "",
    "| Category | Tickets | Precision | Recall | F1 |",
    "| --- | --- | --- | --- | --- |",
    ...s.triage.categoryF1.perLabel.map(
      (l) => `| ${l.label} | ${l.support} | ${num(l.precision, 2)} | ${num(l.recall, 2)} | ${num(l.f1, 2)} |`,
    ),
    "",
    "## Regression floors",
    "",
  );
  if (!r.floors.checked) lines.push("Not checked in this run.");
  else if (r.floors.failures.length === 0) lines.push("Every floor in `eval/floors.json` passed.");
  else {
    lines.push("| Metric | Limit | Result |", "| --- | --- | --- |");
    for (const f of r.floors.failures) {
      lines.push(
        `| ${f.metric} | ${f.kind === "min" ? "≥" : "≤"} ${f.limit} | ${f.actual === null ? "no data" : f.actual.toFixed(3)} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
