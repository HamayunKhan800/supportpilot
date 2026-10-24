import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { periodChange, sparkPoints } from "./scale";

const WIDTH = 100;
const HEIGHT = 28;

/**
 * A small trend line under a KPI (design step 4). Decorative: the number is written beside it
 * and the per-day values are in the page's charts and their tables, so it is hidden from
 * screen readers. SVG geometry only (the CSP forbids inline styles).
 */
export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const points = sparkPoints(values, { width: WIDTH, height: HEIGHT });
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      viewBox={`0 -2 ${WIDTH} ${HEIGHT + 4}`}
      preserveAspectRatio="none"
      className="block h-8 w-full"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={`0,${HEIGHT} ${line} ${WIDTH},${HEIGHT}`} className="fill-chart-1/15" />
      <polyline
        points={line}
        fill="none"
        className="stroke-chart-1"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * "Last 15 days: up 23% vs the 15 before": the newer half of the period against the older half.
 * Neutral colours on purpose: more tickets or tokens is neither good nor bad by itself.
 */
export function ChangeNote({ values, format }: { values: readonly number[]; format: (n: number) => string }) {
  const change = periodChange(values);
  if (!change) return null;
  const { recent, prior, days, ratio } = change;
  const last = days === 1 ? "Last day" : `Last ${days} days`;
  const before = days === 1 ? "the day before" : `the ${days} before`;
  let Icon = ArrowRight;
  let text: string;
  if (recent === 0 && prior === 0) text = "None in this period";
  else if (recent === prior) text = `${last}: same as ${before}`;
  else if (ratio === null) {
    Icon = ArrowUpRight;
    text = `${last}: ${format(recent)}, none in ${before}`;
  } else {
    Icon = ratio > 0 ? ArrowUpRight : ArrowDownRight;
    const pct = Math.abs(ratio) * 100;
    text = `${last}: ${ratio > 0 ? "up" : "down"} ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% vs ${before}`;
  }
  return (
    <span className="inline-flex items-start gap-1">
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{text}</span>
    </span>
  );
}
