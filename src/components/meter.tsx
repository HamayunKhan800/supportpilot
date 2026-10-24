import { cn } from "@/lib/utils";

const FILL = {
  brand: "fill-primary",
  success: "fill-success",
  warning: "fill-warning",
  danger: "fill-danger",
  neutral: "fill-muted-foreground",
} as const;

/**
 * A thin horizontal bar, optionally with a marker line (e.g. a threshold). Decorative: the
 * number it shows must always be in nearby text. SVG geometry rather than inline styles,
 * because the CSP does not allow inline styles.
 */
export function MeterBar({
  value,
  max = 1,
  marker,
  tone = "brand",
  className,
}: {
  value: number;
  max?: number;
  marker?: number;
  tone?: keyof typeof FILL;
  className?: string;
}) {
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <svg aria-hidden="true" focusable="false" width="100%" height="12" className={cn("block", className)}>
      <rect y="3" width="100%" height="6" rx="3" className="fill-muted" />
      <rect y="3" width={pct(value)} height="6" rx="3" className={FILL[tone]} />
      {marker !== undefined && (
        <rect
          x={pct(marker)}
          width="2"
          height="12"
          rx="1"
          transform="translate(-1 0)"
          className="fill-foreground"
        />
      )}
    </svg>
  );
}
