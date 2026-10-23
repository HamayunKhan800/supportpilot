import { position } from "./scale";

const LENGTH = 100;

/**
 * A 0–100% track showing a measured rate (the dark mark), its 95% interval (the grey band) and
 * the target (the dashed line). Decorative: the same numbers are always written out next to
 * it, so it is hidden from screen readers.
 */
export function IntervalBar({
  value,
  low,
  high,
  target,
}: {
  value: number | null;
  low: number | null;
  high: number | null;
  target?: number;
}) {
  const t = target === undefined ? null : position(target, LENGTH);
  return (
    <svg
      viewBox={`0 0 ${LENGTH} 12`}
      preserveAspectRatio="none"
      className="h-3 w-full"
      aria-hidden="true"
      focusable="false"
      data-testid="interval-bar"
    >
      <rect x={0} y={4} width={LENGTH} height={4} rx={1} className="fill-muted" />
      {low !== null && high !== null && (
        <rect
          x={position(low, LENGTH)}
          y={2}
          width={Math.max(position(high, LENGTH) - position(low, LENGTH), 0.6)}
          height={8}
          className="fill-muted-foreground/45"
        />
      )}
      {value !== null && (
        <rect
          x={Math.min(Math.max(position(value, LENGTH) - 0.75, 0), LENGTH - 1.5)}
          y={0}
          width={1.5}
          height={12}
          className="fill-foreground"
        />
      )}
      {t !== null && (
        <line
          x1={t}
          x2={t}
          y1={0}
          y2={12}
          className="stroke-destructive"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/** The key for every IntervalBar on a page, written out once. */
export function IntervalLegend() {
  return (
    <p className="text-muted-foreground text-xs">
      On each bar: the dark mark is the measured rate, the grey band its 95% uncertainty range, and the dashed
      line the target.
    </p>
  );
}
