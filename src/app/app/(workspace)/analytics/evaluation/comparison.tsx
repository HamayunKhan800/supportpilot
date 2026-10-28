import { TableScroll } from "@/components/table-scroll";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatShare } from "@/lib/format";
import type { EvalRunListing } from "@/server/modules/analytics/service";
import {
  type ChangeVerdict,
  compareRuns,
  type MetricChange,
  settingsChanges,
} from "@/server/modules/eval/summary-view";
import { Block, STATUS, td, th } from "./report-parts";

const VERDICT: Record<ChangeVerdict, { label: string; tone: string }> = {
  better: { label: "Better", tone: "border-success-border bg-success-subtle text-success-strong" },
  worse: { label: "Worse", tone: "border-danger-border bg-danger-subtle text-danger-strong" },
  unclear: { label: "Could be chance", tone: "border-border text-muted-foreground" },
  same: { label: "No change", tone: "border-border text-muted-foreground" },
};

/** Rates as percentages with the change in points; 0–1 scores (MRR, F1) as decimals. */
function value(c: MetricChange, v: number) {
  return c.def.kind === "rate" ? formatShare(v, 1) : v.toFixed(2);
}
function change(c: MetricChange) {
  const sign = c.delta > 0 ? "+" : c.delta < 0 ? "−" : "±";
  const size = Math.abs(c.delta);
  return c.def.kind === "rate" ? `${sign}${(size * 100).toFixed(1)} pts` : `${sign}${size.toFixed(2)}`;
}

const runName = (r: EvalRunListing) =>
  `${formatDateTime(r.startedAt)} (${(STATUS[r.status] ?? { label: r.status }).label.toLowerCase()})`;

/**
 * The newest run against the one before it (after Braintrust's experiment comparison): what
 * changed in the settings, a one-line verdict, then each metric both runs measured.
 */
export function RunComparison({ newer, older }: { newer: EvalRunListing; older: EvalRunListing }) {
  const changes = compareRuns(newer.summary, older.summary);
  const settings = settingsChanges(newer.config, older.config);
  const count = (v: ChangeVerdict) => changes.filter((c) => c.verdict === v).length;
  const named = (v: ChangeVerdict) =>
    changes
      .filter((c) => c.verdict === v)
      .map((c) => `${c.def.label} (${change(c)})`)
      .join(", ");

  return (
    <Block
      id="comparison"
      title="What changed in the newest run"
      description="Against the run before it, on the metrics both measured. A change counts as better or worse only when the two 95% ranges don't overlap; smaller moves could be chance."
      bodyClassName="flex flex-col gap-4"
    >
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Newest run</dt>
          <dd>{runName(newer)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Compared with</dt>
          <dd>{runName(older)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Settings changed</dt>
          <dd className="font-mono text-xs break-words">
            {settings.length ? settings.join(" · ") : "None: same prompts and models"}
          </dd>
        </div>
      </dl>
      {changes.length === 0 ? (
        <p className="text-muted-foreground text-sm">No metric was measured in both runs.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong className="font-medium">
              {count("better")} better, {count("worse")} worse
            </strong>
            , {count("unclear")} within their ranges, {count("same")} unchanged.
            {count("better") > 0 && <> Better: {named("better")}.</>}
            {count("worse") > 0 && <> Worse: {named("worse")}.</>}
          </p>
          <TableScroll label="Metrics in both runs">
            <table className="w-full text-sm">
              <caption className="sr-only">Each metric in the previous and the newest run</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className={th}>
                    Metric
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Before
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Newest
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.def.key} className="border-t">
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {c.def.label}
                      <span className="text-muted-foreground block text-xs">{c.def.group}</span>
                    </th>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {value(c, c.before)}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{value(c, c.after)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="tabular-nums">{change(c)}</span>
                        <Badge variant="outline" className={VERDICT[c.verdict].tone}>
                          {VERDICT[c.verdict].label}
                        </Badge>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </Block>
  );
}
