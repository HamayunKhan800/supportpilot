import { TrendLine } from "@/components/charts/trend-line";
import { TableScroll } from "@/components/table-scroll";
import { formatCount, formatDateTime, formatShare } from "@/lib/format";
import type { EvalRunListing } from "@/server/modules/analytics/service";
import { EVAL_METRICS, itemsMeasured, metricValues } from "@/server/modules/eval/summary-view";
import { Block, STATUS, td, th } from "./report-parts";

const shortDate = (d: Date) => d.toISOString().slice(0, 10);

/** Headline metrics across the recent runs: small line charts, then the same numbers as a table. */
export function Trend({ runs }: { runs: readonly EvalRunListing[] }) {
  const ordered = [...runs].reverse(); // oldest first, left to right
  const headline = EVAL_METRICS.filter((m) => m.headline);
  const valuesByRun = ordered.map((r) => metricValues(r.summary));
  const runNames = ordered.map((r) => shortDate(r.startedAt));
  return (
    <Block
      id="trend"
      title="Trend across runs"
      description={`The last ${ordered.length} runs, oldest first, on a 0–100% scale. A drop after a prompt or model change shows here.`}
      bodyClassName="flex flex-col gap-6"
    >
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
    </Block>
  );
}
