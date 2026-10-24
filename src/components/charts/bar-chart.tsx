import { TableScroll } from "@/components/table-scroll";

import { barLayout, niceMax } from "./scale";
import { CHART_TONES, type ChartTone } from "./stacked-bar";

export interface BarDatum {
  key: string;
  /** Shown on the axis and in the table, e.g. "23 Oct". */
  label: string;
  value: number;
}

const WIDTH_PER_BAR = 10;
const HEIGHT = 100;

/**
 * A daily bar chart drawn as inline SVG (M6 D10): no chart library, no inline styles (CSP),
 * colours from the theme. Screen readers get a one-sentence summary on the image and the full
 * data in a table under "Show as a table", which sighted users can open too.
 */
export function BarChart({
  title,
  data,
  formatValue,
  valueHeader,
  tone = 1,
}: {
  /** What one bar is, e.g. "Tickets created per day". */
  title: string;
  data: readonly BarDatum[];
  formatValue: (n: number) => string;
  valueHeader: string;
  /** Theme chart colour for the bars. */
  tone?: ChartTone;
}) {
  if (data.length === 0) return null;
  const values = data.map((d) => d.value);
  const top = niceMax(Math.max(...values));
  const width = data.length * WIDTH_PER_BAR;
  const bars = barLayout(values, {
    width,
    height: HEIGHT,
    gap: data.length > 40 ? 0.15 : 0.25,
    minHeight: 2,
    max: top,
  });
  const total = values.reduce((n, v) => n + v, 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]!);
  const first = data[0]!.label;
  const last = data[data.length - 1]!.label;
  const summary =
    total === 0
      ? `${title}, ${first} to ${last}: none.`
      : `${title}, ${first} to ${last}: ${formatValue(total)} in total, highest ${formatValue(peak.value)} on ${peak.label}.`;

  return (
    <figure className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <div
          aria-hidden="true"
          className="text-muted-foreground flex flex-col justify-between text-right text-xs tabular-nums"
        >
          <span>{formatValue(top)}</span>
          {/* The middle label only when it is a whole number: a count axis of 1 has no honest middle. */}
          <span>{Number.isInteger(top / 2) ? formatValue(top / 2) : ""}</span>
          <span>0</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
          role="img"
          aria-label={summary}
        >
          <line
            x1={0}
            y1={HEIGHT / 2}
            x2={width}
            y2={HEIGHT / 2}
            className="stroke-border"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={0}
            x2={width}
            y2={0}
            className="stroke-border"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={HEIGHT}
            x2={width}
            y2={HEIGHT}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          {bars.map((b, i) =>
            b.height > 0 ? (
              <rect
                key={data[i]!.key}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                className={`${CHART_TONES[tone].fill} hover:opacity-80`}
              >
                <title>{`${data[i]!.label}: ${formatValue(data[i]!.value)}`}</title>
              </rect>
            ) : null,
          )}
        </svg>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="text-muted-foreground flex justify-between text-xs">
          <span>{first}</span>
          <span>{last}</span>
        </div>
      </div>
      <figcaption className="sr-only">{title}</figcaption>
      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
          Show as a table
        </summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <TableScroll label={`${title}: data`}>
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Day (UTC)
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    {valueHeader}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.key} className="border-t">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {d.label}
                    </th>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </details>
    </figure>
  );
}
