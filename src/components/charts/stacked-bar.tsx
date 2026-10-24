import { cn } from "@/lib/utils";

/** Chart colours from the theme (contrast-checked tokens), as fill and as swatch background. */
export const CHART_TONES = {
  1: { fill: "fill-chart-1", swatch: "bg-chart-1" },
  2: { fill: "fill-chart-2", swatch: "bg-chart-2" },
  3: { fill: "fill-chart-3", swatch: "bg-chart-3" },
  4: { fill: "fill-chart-4", swatch: "bg-chart-4" },
  5: { fill: "fill-chart-5", swatch: "bg-chart-5" },
} as const;
export type ChartTone = keyof typeof CHART_TONES;

export interface StackedSegment {
  key: string;
  label: string;
  value: number;
  tone: ChartTone;
}

/**
 * One horizontal bar split into coloured parts, with a legend that names every part, its count
 * and share. The legend is the accessible version (a list of text); the bar is decorative.
 */
export function StackedBar({
  label,
  segments,
  formatValue,
  hideEmpty = false,
  className,
}: {
  /** Names the legend list, e.g. "Tickets by status". */
  label: string;
  segments: readonly StackedSegment[];
  formatValue: (n: number) => string;
  /** Leave parts with no value out of the legend (they have no width on the bar either). */
  hideEmpty?: boolean;
  className?: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  let x = 0;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="block h-2.5 w-full overflow-hidden rounded-full"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="100" height="8" className="fill-muted" />
        {total > 0 &&
          segments.map((s) => {
            const width = (s.value / total) * 100;
            const rect =
              width > 0 ? (
                <rect key={s.key} x={x} width={width} height="8" className={CHART_TONES[s.tone].fill} />
              ) : null;
            x += width;
            return rect;
          })}
      </svg>
      <ul aria-label={label} className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {segments
          .filter((s) => !hideEmpty || s.value > 0)
          .map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-sm", CHART_TONES[s.tone].swatch)}
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">{formatValue(s.value)}</span>
              {total > 0 && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {Math.round((s.value / total) * 100)}%
                </span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}
