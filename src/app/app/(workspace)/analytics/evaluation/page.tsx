import type { Metadata } from "next";
import { headers } from "next/headers";
import { IntervalBar, IntervalLegend } from "@/components/charts/interval-bar";
import { TrendLine } from "@/components/charts/trend-line";
import { Forbidden } from "@/components/forbidden";
import { TableScroll } from "@/components/table-scroll";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, formatDateTime, formatMs, formatShare, formatUsd } from "@/lib/format";
import { EVAL_PROVIDERS, type EvalProvider } from "@/server/modules/eval/constants";
import {
  EVAL_METRICS,
  itemsMeasured,
  METRIC_GROUPS,
  metricValues,
  numberAt,
  rateAt,
  runLabels,
  spreadAt,
  stringListAt,
  type MetricValue,
  type Target,
} from "@/server/modules/eval/summary-view";
import { parseProvider } from "@/server/modules/analytics/periods";
import { getEvaluationOverview, type EvalRunListing } from "@/server/modules/analytics/service";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { AnalyticsHeader, OptionLinks, Stat } from "../analytics-header";

export const metadata: Metadata = { title: "AI evaluation" };

const PROVIDER_LABELS: Record<EvalProvider, string> = { gemini: "Gemini", mock: "Mock" };

const STATUS: Record<string, { label: string; variant: "secondary" | "outline" }> = {
  completed: { label: "Complete", variant: "secondary" },
  stopped: { label: "Partial", variant: "outline" },
  running: { label: "Running or interrupted", variant: "outline" },
};

const th = "px-3 py-2 font-medium whitespace-nowrap";
const td = "px-3 py-2";

const targetText = (t: Target) => `${t.op === "min" ? "≥" : "≤"} ${formatShare(t.value)}`;
const shortDate = (d: Date) => d.toISOString().slice(0, 10);

function MetricRow({ m }: { m: MetricValue }) {
  const { def, value, rate, meets } = m;
  const shown = def.kind === "score" && value !== null ? value.toFixed(2) : formatShare(value);
  return (
    <li className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-medium">{def.label}</h4>
        <p className="text-xl font-semibold tabular-nums">{shown}</p>
      </div>
      {def.kind === "rate" && (
        <IntervalBar
          value={value}
          low={rate?.low ?? null}
          high={rate?.high ?? null}
          target={def.target?.value}
        />
      )}
      <p className="text-muted-foreground text-xs">
        {rate && (
          <>
            95% range {formatShare(rate.low)}–{formatShare(rate.high)} · {rate.successes} of {rate.n}
          </>
        )}
        {def.target && (
          <>
            {rate && " · "}target {targetText(def.target)}
            {meets !== null && (
              <span className={meets ? "text-foreground font-medium" : "text-destructive font-medium"}>
                {meets ? " · met" : " · not met"}
              </span>
            )}
          </>
        )}
        {!def.target && value !== null && def.kind === "rate" && " · reported, no target"}
      </p>
      {def.note && <p className="text-muted-foreground text-xs">{def.note}</p>}
    </li>
  );
}

function LatestRun({ run }: { run: EvalRunListing }) {
  const summary = run.summary;
  const labels = runLabels(run.config);
  const status = STATUS[run.status] ?? { label: run.status, variant: "outline" as const };
  const values = metricValues(summary);
  const errors = [
    { label: "Triage", rate: rateAt(summary, "triage.errors") },
    { label: "Drafts", rate: rateAt(summary, "drafts.errors") },
    { label: "Injection cases", rate: rateAt(summary, "injection.errors") },
  ];
  const latency = [
    { label: "Knowledge search", spread: spreadAt(summary, "retrieval.latencyMs") },
    { label: "Triage", spread: spreadAt(summary, "triage.latencyMs") },
    { label: "Draft, first text", spread: spreadAt(summary, "drafts.ttftMs") },
    { label: "Draft, start to finish", spread: spreadAt(summary, "drafts.endToEndMs") },
  ];
  const obeyed = stringListAt(summary, "injection.obeyed");
  const caught = new Set(stringListAt(summary, "injection.obeyedCaughtByCode"));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex flex-wrap items-center gap-2">
              Latest {PROVIDER_LABELS[run.provider]} run
              <Badge variant={status.variant}>{status.label}</Badge>
            </h2>
          </CardTitle>
          <CardDescription>
            Started {formatDateTime(run.startedAt)}
            {run.finishedAt
              ? `, finished ${formatDateTime(run.finishedAt)}`
              : `, last saved ${formatDateTime(run.updatedAt)}`}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {run.provider === "mock" && (
            <p className="bg-muted rounded-md p-3 text-sm">
              <strong>Mock run.</strong> A scripted stand-in plays the AI, so these numbers test the pipeline
              and guard CI against regressions. They say nothing about the quality of a real model.
            </p>
          )}
          {run.status !== "completed" && (
            <p className="rounded-md border p-3 text-sm">
              <strong>Not finished.</strong> The numbers cover only the items measured so far.
              {run.stopReason && <> Stopped because: {run.stopReason.slice(0, 200)}.</>}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Items measured" value={formatCount(itemsMeasured(summary))} />
            <Stat label="AI requests" value={formatCount(run.calls)} />
            <Stat
              label="Estimated cost"
              value={formatUsd(numberAt(summary, "cost.estCostUsd"))}
              detail="paid-tier price"
            />
            <Stat
              label="Per draft / per triage"
              value={formatUsd(numberAt(summary, "cost.perDraftUsd"))}
              detail={`triage ${formatUsd(numberAt(summary, "cost.perTriageUsd"))}`}
            />
          </dl>
          {(labels.prompts.length > 0 || labels.models.length > 0) && (
            <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-foreground font-medium">Prompt versions</dt>
                <dd className="font-mono">{labels.prompts.join(", ") || "not recorded"}</dd>
              </div>
              <div>
                <dt className="text-foreground font-medium">Models</dt>
                <dd className="font-mono break-words">{labels.models.join(", ") || "not recorded"}</dd>
              </div>
            </dl>
          )}
          <IntervalLegend />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {METRIC_GROUPS.map((group) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle>
                <h3>{group}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3">
                {values
                  .filter((m) => m.def.group === group)
                  .map((m) => (
                    <MetricRow key={m.def.key} m={m} />
                  ))}
              </ul>
              {group === "Safety" && obeyed.length > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Attacks the model followed:{" "}
                  {obeyed.map((id) => (caught.has(id) ? `${id} (caught by code)` : id)).join(", ")}.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Reliability and speed</h3>
          </CardTitle>
          <CardDescription>
            A technical failure (no answer from the AI service) is counted here and left out of the quality
            numbers above.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <TableScroll label="Technical failures">
            <table className="w-full text-sm">
              <caption className="sr-only">Technical failures</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className={th}>
                    Suite
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    No answer
                  </th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.label} className="border-t">
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {e.label}
                    </th>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {e.rate
                        ? `${formatShare(e.rate.rate)} (${e.rate.successes} of ${e.rate.n})`
                        : "no data"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <TableScroll label="Latency">
            <table className="w-full text-sm">
              <caption className="sr-only">Latency</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className={th}>
                    Step
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    p50
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    p95
                  </th>
                </tr>
              </thead>
              <tbody>
                {latency.map((l) => (
                  <tr key={l.label} className="border-t">
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {l.label}
                    </th>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {formatMs(l.spread?.p50 ?? null)}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {formatMs(l.spread?.p95 ?? null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </CardContent>
      </Card>
    </>
  );
}

function Trend({ runs }: { runs: readonly EvalRunListing[] }) {
  const ordered = [...runs].reverse(); // oldest first, left to right
  const headline = EVAL_METRICS.filter((m) => m.headline);
  const valuesByRun = ordered.map((r) => metricValues(r.summary));
  const runNames = ordered.map((r) => shortDate(r.startedAt));
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Trend across runs</h2>
        </CardTitle>
        <CardDescription>
          The last {ordered.length} runs, oldest first, on a 0–100% scale. A drop after a prompt or model
          change shows here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {headline.map((def) => (
            <li key={def.key} className="flex flex-col gap-1">
              <span className="text-sm font-medium">{def.label}</span>
              <TrendLine
                label={def.label}
                values={valuesByRun.map((vs) => vs.find((v) => v.def.key === def.key)?.value ?? null)}
                runLabels={runNames}
                target={def.target?.value}
              />
            </li>
          ))}
        </ul>
        <TableScroll label="Runs and their headline numbers">
          <table className="w-full text-sm">
            <caption className="sr-only">Runs and their headline numbers, newest first</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className={th}>
                  Run
                </th>
                {headline.map((def) => (
                  <th key={def.key} scope="col" className={`${th} text-right`}>
                    {def.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const vs = metricValues(r.summary);
                return (
                  <tr key={r.id} className="border-t">
                    <th scope="row" className={`${td} text-left font-normal whitespace-nowrap`}>
                      {formatDateTime(r.startedAt)}
                      <span className="text-muted-foreground block text-xs">
                        {(STATUS[r.status] ?? { label: r.status }).label} ·{" "}
                        {formatCount(itemsMeasured(r.summary))} items
                      </span>
                    </th>
                    {headline.map((def) => (
                      <td key={def.key} className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatShare(vs.find((v) => v.def.key === def.key)?.value ?? null)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </CardContent>
    </Card>
  );
}

export default async function EvaluationPage({ searchParams }: PageProps<"/app/analytics/evaluation">) {
  const { provider: rawProvider } = await searchParams;
  await requireAppWorkspace();
  let overview;
  try {
    overview = await getEvaluationOverview(await headers(), parseProvider(rawProvider));
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return <Forbidden what="analytics" />;
    throw err;
  }
  const { provider, runCounts, runs } = overview;
  const latest = runs[0];

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsHeader
        current="evaluation"
        intro="How well the AI does on fixed test sets (docs/04): synthetic tickets and questions with known answers, the same for every workspace."
      />
      <OptionLinks
        label="Provider"
        options={EVAL_PROVIDERS.map((p) => ({
          href: `/app/analytics/evaluation?provider=${p}`,
          label: `${PROVIDER_LABELS[p]} (${runCounts[p] ?? 0} ${(runCounts[p] ?? 0) === 1 ? "run" : "runs"})`,
          current: p === provider,
        }))}
      />
      {latest ? (
        <>
          <LatestRun run={latest} />
          {runs.length > 1 && <Trend runs={runs} />}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No {PROVIDER_LABELS[provider]} runs yet</h2>
            </CardTitle>
            <CardDescription>
              Results appear here after the evaluation runs against this database (
              <code className="font-mono">pnpm eval{provider === "gemini" ? " --provider gemini" : ""}</code>
              ).
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
