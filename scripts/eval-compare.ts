/**
 * Triage prompt v1 vs v2 on the same tickets (M6 plan D6a): pairs two evaluation result files and
 * applies the decision rule fixed before any Gemini data (scripts/lib/triage-compare.ts).
 *
 *   pnpm eval:compare --v1 eval/results/eval-gemini-<v1>.json --v2 eval/results/eval-gemini-<v2>.json
 *   pnpm eval:compare --v1 ... --v2 ... --out docs/eval/triage-v1-v2.md   # also write the table
 *
 * Refuses to compare runs with different datasets, providers or triage models, or runs that
 * aren't v1 and v2: then a difference could come from something other than the prompt.
 * Reads only the result files: no database, no API calls.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { formatRate } from "../src/server/modules/eval/stats";
import {
  decideTriagePrompt,
  triageCorrectness,
  type MetricComparison,
  type TriageItemLike,
} from "./lib/triage-compare";

interface ResultFile {
  run: {
    id: string;
    provider: string;
    status: string;
    datasetHash: string;
    config: { promptVersions?: { triage?: string }; models?: { triage?: string } };
  };
  items: TriageItemLike[];
}

const { values } = parseArgs({
  options: { v1: { type: "string" }, v2: { type: "string" }, out: { type: "string" } },
});

function load(file: string | undefined, flag: string): ResultFile {
  if (!file) throw new Error(`--${flag} <result file> is required`);
  const data = JSON.parse(readFileSync(file, "utf8")) as ResultFile;
  if (!data.run?.id || !Array.isArray(data.items))
    throw new Error(`${file} is not an evaluation result file`);
  return data;
}

const p = (x: number) => (x < 0.001 ? "< 0.001" : x.toFixed(3));

function row(name: string, m: MetricComparison): string {
  return `| ${name} | ${formatRate(m.v1, 1)} | ${formatRate(m.v2, 1)} | ${m.onlyA} | ${m.onlyB} | ${p(m.pValue)} |`;
}

function main() {
  const a = load(values.v1, "v1");
  const b = load(values.v2, "v2");
  const problems: string[] = [];
  if (a.run.config.promptVersions?.triage !== "triage.v1") problems.push("--v1 is not a triage.v1 run");
  if (b.run.config.promptVersions?.triage !== "triage.v2") problems.push("--v2 is not a triage.v2 run");
  if (a.run.datasetHash !== b.run.datasetHash) problems.push("the runs used different datasets");
  if (a.run.provider !== b.run.provider) problems.push("the runs used different providers");
  if (a.run.config.models?.triage !== b.run.config.models?.triage)
    problems.push("the runs used different triage models");
  if (problems.length > 0) throw new Error(`Not comparable: ${problems.join("; ")}.`);

  const v1 = triageCorrectness(a.items);
  const v2 = triageCorrectness(b.items);
  const d = decideTriagePrompt(v1, v2);
  const verdict = {
    "adopt-v2": "**Adopt v2**: better on at least one metric and worse on neither, at p < 0.025.",
    "keep-v1-no-difference": "**Keep v1**: no measurable difference at p < 0.025.",
    "keep-v1-v2-worse": "**Keep v1**: v2 is worse on at least one metric at p < 0.025.",
  }[d.verdict];

  const lines = [
    `Runs: v1 \`${a.run.id}\` (${a.run.status}), v2 \`${b.run.id}\` (${b.run.status}).`,
    `Provider ${a.run.provider}, triage model \`${a.run.config.models?.triage ?? "?"}\`, same dataset (\`${a.run.datasetHash.slice(0, 12)}\`).`,
    `Paired tickets (answered by both): ${d.category.n} (v1 answered ${v1.category.size}, v2 ${v2.category.size}).`,
    "",
    "| Metric | v1 (95% range, n) | v2 (95% range, n) | Right only with v1 | Right only with v2 | Exact McNemar p |",
    "| --- | --- | --- | --- | --- | --- |",
    row("Category", d.category),
    row("Priority, exact", d.priority),
    "",
    `Decision rule (fixed before any data): adopt v2 only if a metric is higher with p < ${d.alpha} and neither is lower with p < ${d.alpha}.`,
    "",
    verdict,
  ];
  const text = lines.join("\n") + "\n";
  console.log(text);
  if (values.out) writeFileSync(values.out, text);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
