import { Info, TriangleAlert } from "lucide-react";
import { IntervalBar, IntervalLegend } from "@/components/charts/interval-bar";
import { TableScroll } from "@/components/table-scroll";
import { Badge } from "@/components/ui/badge";
import { formatCount, formatDateTime, formatMs, formatShare, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EvalRunListing } from "@/server/modules/analytics/service";
import {
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
import { Block, PROVIDER_LABELS, RunFigure, STATUS, TargetChip, td, th } from "./report-parts";

type Summary = EvalRunListing["summary"];

const targetText = (t: Target) => `${t.op === "min" ? "≥" : "≤"} ${formatShare(t.value)}`;

/** The newest complete run: its summary, every metric by group, then reliability and speed. */
export function LatestRun({ run, newer }: { run: EvalRunListing; newer: EvalRunListing | null }) {
  const values = metricValues(run.summary);
  return (
    <>
      <RunSummary run={run} newer={newer} values={values} />
      <MetricGroups summary={run.summary} values={values} />
      <Reliability summary={run.summary} />
    </>
  );
}

function RunSummary({
  run,
  newer,
  values,
}: {
  run: EvalRunListing;
  newer: EvalRunListing | null;
  values: MetricValue[];
}) {
  const summary = run.summary;
  const labels = runLabels(run.config);
  const status = STATUS[run.status] ?? { label: run.status, variant: "outline" as const };
  const targeted = values.filter((v) => v.def.target && v.meets !== null);
  const met = targeted.filter((v) => v.meets).length;
  const unmeasured = values.filter((v) => v.def.target && v.meets === null).length;

  return (
    <section id="latest-run" aria-labelledby="latest-run-heading" className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 border-y py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="latest-run-heading" className="flex flex-wrap items-center gap-2 text-base font-semibold">
              Latest {newer ? "complete " : ""}
              {PROVIDER_LABELS[run.provider]} run
              <Badge variant={status.variant}>{status.label}</Badge>
            </h2>
            <p className="text-muted-foreground text-sm">
              Started {formatDateTime(run.startedAt)}
              {run.finishedAt
                ? `, finished ${formatDateTime(run.finishedAt)}`
                : `, last saved ${formatDateTime(run.updatedAt)}`}
              .
            </p>
          </div>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">
            {targeted.length ? `${met} of ${targeted.length}` : "No"}
            <span className="text-muted-foreground ml-2 text-lg font-normal tracking-normal">
              {targeted.length ? "targets met" : "targets measured yet"}
            </span>
          </p>
          {/* One segment per target, in the order of the lists below; the numbers say it in words. */}
          {values.some((v) => v.def.target) && (
            <ul aria-hidden="true" className="flex max-w-md gap-1">
              {values
                .filter((v) => v.def.target)
                .map((v) => (
                  <li
                    key={v.def.key}
                    title={v.def.label}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      v.meets === true ? "bg-success" : v.meets === false ? "bg-danger" : "bg-muted",
                    )}
                  />
                ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            {unmeasured ? `${unmeasured} more not measured yet. ` : ""}Targets are hypotheses to test
            (docs/04), not promises.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-x-8 gap-y-1 lg:text-right">
          <RunFigure label="Items measured" value={formatCount(itemsMeasured(summary))} />
          <RunFigure label="AI requests" value={formatCount(run.calls)} />
          <RunFigure
            label="Estimated cost"
            value={formatUsd(numberAt(summary, "cost.estCostUsd"))}
            detail={`per draft ${formatUsd(numberAt(summary, "cost.perDraftUsd"))}`}
          />
        </dl>
      </div>
      <RunNotices run={run} newer={newer} />
      {(labels.prompts.length > 0 || labels.models.length > 0) && (
        <dl className="text-muted-foreground grid gap-3 text-xs sm:grid-cols-2">
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
    </section>
  );
}

/** Caveats that change how the run's numbers should be read. */
function RunNotices({ run, newer }: { run: EvalRunListing; newer: EvalRunListing | null }) {
  return (
    <>
      {run.provider === "mock" && (
        <p className="border-info-border bg-info-subtle text-info-strong flex gap-2 rounded-lg border px-3 py-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="max-w-prose">
            <strong>Mock run.</strong> A scripted stand-in plays the AI, so these numbers test the pipeline
            and guard CI against regressions. They say nothing about the quality of a real model.
          </span>
        </p>
      )}
      {newer && (
        <p className="border-warning-border bg-warning-subtle text-warning-strong flex gap-2 rounded-lg border px-3 py-2 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="max-w-prose">
            <strong>A newer run is not finished.</strong> It started {formatDateTime(newer.startedAt)} and
            measured {formatCount(itemsMeasured(newer.summary))} items
            {runLabels(newer.config).prompts.length > 0 && (
              <> with prompts {runLabels(newer.config).prompts.join(", ")}</>
            )}
            .{newer.stopReason && <> Stopped because: {newer.stopReason.slice(0, 200)}.</>} Its numbers are in
            the trend below; this section shows the newest complete run.
          </span>
        </p>
      )}
      {run.status !== "completed" && (
        <p className="border-warning-border bg-warning-subtle text-warning-strong flex gap-2 rounded-lg border px-3 py-2 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="max-w-prose">
            <strong>Not finished.</strong> The numbers cover only the items measured so far.
            {run.stopReason && <> Stopped because: {run.stopReason.slice(0, 200)}.</>}
          </span>
        </p>
      )}
    </>
  );
}

function MetricGroups({ summary, values }: { summary: Summary; values: MetricValue[] }) {
  const obeyed = stringListAt(summary, "injection.obeyed");
  const caught = new Set(stringListAt(summary, "injection.obeyedCaughtByCode"));
  return (
    <div className="flex flex-col gap-4">
      <IntervalLegend />
      <div className="grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-2">
        {METRIC_GROUPS.map((group) => (
          <Block key={group} id={`group-${group.toLowerCase().replace(/\W+/g, "-")}`} title={group} level={3}>
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
          </Block>
        ))}
      </div>
    </div>
  );
}

function MetricRow({ m }: { m: MetricValue }) {
  const { def, value, rate, meets } = m;
  const shown = def.kind === "score" && value !== null ? value.toFixed(2) : formatShare(value);
  return (
    <li className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {def.label}
          {def.key === "groundedness" && (
            <Badge variant="outline" className="border-info-border text-info-strong gap-1 font-normal">
              AI-graded
            </Badge>
          )}
        </h4>
        <div className="flex items-center gap-2">
          <TargetChip meets={def.target ? meets : undefined} />
          <p className="text-xl font-semibold tabular-nums">{shown}</p>
        </div>
      </div>
      {def.kind === "rate" && (
        <IntervalBar
          value={value}
          low={rate?.low ?? null}
          high={rate?.high ?? null}
          target={def.target?.value}
          meets={meets}
        />
      )}
      <MetricCaption m={m} />
      {def.note && <p className="text-muted-foreground text-xs">{def.note}</p>}
    </li>
  );
}

/** "95% range 80–92% · 46 of 50 · target ≥ 85% · met", or as much of it as applies. */
function MetricCaption({ m }: { m: MetricValue }) {
  const { def, value, rate, meets } = m;
  return (
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
            <span className={meets ? "text-success-strong font-medium" : "text-danger-strong font-medium"}>
              {meets ? " · met" : " · not met"}
            </span>
          )}
        </>
      )}
      {!def.target && value !== null && def.kind === "rate" && " · reported, no target"}
    </p>
  );
}

function Reliability({ summary }: { summary: Summary }) {
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
  return (
    <Block
      id="reliability"
      level={3}
      title="Reliability and speed"
      description="A technical failure (no answer from the AI service) is counted here and left out of the quality numbers above."
      bodyClassName="grid grid-cols-1 gap-6 md:grid-cols-2"
    >
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
                  {e.rate ? `${formatShare(e.rate.rate)} (${e.rate.successes} of ${e.rate.n})` : "no data"}
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
    </Block>
  );
}
