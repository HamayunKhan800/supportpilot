"use client";

import { useRef, useState } from "react";
import { TableScroll } from "@/components/table-scroll";
import { formatCount, formatMicros } from "@/lib/format";
import { cn } from "@/lib/utils";
import { niceMax } from "./scale";

export interface ChartPoint {
  key: string;
  /** Shown on the axis, in the tooltip and in the table, e.g. "23 Oct". */
  label: string;
  value: number;
}

/** Formats are named, not passed as functions: this is a client component fed by server pages. */
export type ChartFormat = "count" | "usd-micros";
const FORMATS: Record<ChartFormat, (n: number) => string> = {
  count: formatCount,
  "usd-micros": (n) => formatMicros(n),
};

const TONES = {
  1: { line: "stroke-chart-1", area: "fill-chart-1", dot: "bg-chart-1" },
  2: { line: "stroke-chart-2", area: "fill-chart-2", dot: "bg-chart-2" },
  3: { line: "stroke-chart-3", area: "fill-chart-3", dot: "bg-chart-3" },
} as const;

const W = 600;
const H = 200;

/**
 * One large daily chart (design step 10.4/10.5, after Stripe's home and Vercel's analytics).
 * Inline SVG: no chart library and no animation. Hovering, dragging a finger or the arrow keys
 * move a rule across the days, with the day's value in a tooltip and, for screen readers, in a
 * polite live region. The whole series is also a sentence on the image and a real table under
 * "Show as a table". The tooltip and dot exist only after interaction, so the server HTML has
 * no inline styles (CSP).
 */
export function AreaChart({
  title,
  data,
  valueHeader,
  unit,
  format = "count",
  tone = 1,
  className,
}: {
  /** What one point is, e.g. "Tickets created per day"; also the table's name. */
  title: string;
  data: readonly ChartPoint[];
  valueHeader: string;
  /** Read after the value, e.g. "tickets". */
  unit: string;
  format?: ChartFormat;
  tone?: keyof typeof TONES;
  /** Height of the plot, e.g. "h-56". */
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  if (data.length === 0) return null;

  const fmt = FORMATS[format];
  const n = data.length;
  const values = data.map((d) => d.value);
  const top = niceMax(Math.max(...values));
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (top > 0 ? v / top : 0) * H;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;

  const total = values.reduce((s, v) => s + v, 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]!);
  const first = data[0]!.label;
  const last = data[n - 1]!.label;
  const middle = data[Math.floor((n - 1) / 2)]!.label;
  const summary =
    total === 0
      ? `${title}, ${first} to ${last}: none.`
      : `${title}, ${first} to ${last}: ${fmt(total)} in total, highest ${fmt(peak.value)} on ${peak.label}.`;

  const pick = (clientX: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const i = Math.round(((clientX - box.left) / box.width) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = active ?? n - 1;
    const next =
      e.key === "ArrowLeft"
        ? at - 1
        : e.key === "ArrowRight"
          ? at + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, active === null ? at : next)));
  };

  const point = active === null ? null : data[active]!;
  const leftPct = active === null ? 0 : (x(active) / W) * 100;
  const topPct = point ? (y(point.value) / H) * 100 : 0;
  const t = TONES[tone];

  return (
    <figure className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <div
          aria-hidden="true"
          className="text-muted-foreground flex flex-col justify-between text-right text-xs tabular-nums"
        >
          <span>{fmt(top)}</span>
          <span>{Number.isInteger(top / 2) ? fmt(top / 2) : ""}</span>
          <span>0</span>
        </div>
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use the left and right arrow keys to read each day.`}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          className={cn(
            "focus-visible:ring-ring relative touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-4",
            className ?? "h-56",
          )}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="size-full overflow-visible"
            role="img"
            aria-label={summary}
          >
            {[0, H / 2].map((gy) => (
              <line
                key={gy}
                x1={0}
                x2={W}
                y1={gy}
                y2={gy}
                className="stroke-border"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" vectorEffect="non-scaling-stroke" />
            <path d={area} className={t.area} fillOpacity={0.1} />
            <path
              d={line}
              fill="none"
              className={t.line}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={0}
                y2={H}
                className="stroke-foreground/30"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {point && (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "ring-background pointer-events-none absolute size-2.5 -translate-1/2 rounded-full ring-2",
                  t.dot,
                )}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              />
              <div
                aria-hidden="true"
                className={cn(
                  "glass pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md",
                  leftPct < 15 ? "translate-x-0" : leftPct > 85 ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${leftPct}%` }}
              >
                <span className="text-muted-foreground">{point.label}</span>{" "}
                <span className="font-semibold tabular-nums">{fmt(point.value)}</span>
              </div>
            </>
          )}
        </div>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="text-muted-foreground flex justify-between text-xs">
          <span>{first}</span>
          {n > 4 && <span className="hidden sm:inline">{middle}</span>}
          <span>{last}</span>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {point ? `${point.label}: ${fmt(point.value)} ${unit}` : ""}
      </p>
      <figcaption className="sr-only">{title}</figcaption>
      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer">
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
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.value)}</td>
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
