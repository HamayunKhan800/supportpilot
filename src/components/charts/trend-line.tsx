import { lineSegments, position } from "./scale";

const WIDTH = 100;
const HEIGHT = 40;

/**
 * A small line of one metric across runs, oldest to newest, on a fixed 0–100% scale (so two
 * charts are never visually exaggerated by different axes). Runs without data leave a gap.
 * The summary names every value; the trend table under the charts has them too.
 */
export function TrendLine({
  label,
  values,
  runLabels,
  target,
}: {
  label: string;
  /** Oldest first, 0–1 or null. */
  values: readonly (number | null)[];
  runLabels: readonly string[];
  target?: number;
}) {
  const segments = lineSegments(values, { width: WIDTH, height: HEIGHT });
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  const spoken = values
    .map((v, i) => `${runLabels[i] ?? `run ${i + 1}`}: ${v === null ? "no data" : `${Math.round(v * 100)}%`}`)
    .join(", ");
  return (
    <svg
      viewBox={`-2 -2 ${WIDTH + 4} ${HEIGHT + 4}`}
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label={`${label} by run, oldest first. ${spoken}.`}
    >
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="fill-muted/60" />
      {target !== undefined && (
        <line
          x1={0}
          x2={WIDTH}
          y1={HEIGHT - position(target, HEIGHT)}
          y2={HEIGHT - position(target, HEIGHT)}
          className="stroke-muted-foreground"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {segments.map((points, i) =>
        points.length > 1 ? (
          <polyline
            key={i}
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            className="stroke-chart-1"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
      {values.map((v, i) =>
        v === null ? null : (
          <rect
            key={i}
            x={(values.length > 1 ? i * step : WIDTH / 2) - 1}
            y={HEIGHT - position(v, HEIGHT) - 2}
            width={2}
            height={4}
            className="fill-chart-1"
          />
        ),
      )}
    </svg>
  );
}
