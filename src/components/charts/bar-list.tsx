import { cn } from "@/lib/utils";

export interface BarListRow {
  key: string;
  label: React.ReactNode;
  value: number;
  /** The number as shown, e.g. "12". */
  display: string;
  /** Shown after the number, e.g. a share: "46%". */
  detail?: string;
}

/**
 * A ranked list with a light bar behind each row, sized to its value against the largest one, as
 * in Vercel's analytics panels: the biggest item is visible at a glance and the exact number stays
 * on the right. The bar is SVG geometry, not an inline style (the CSP forbids those), and is
 * decorative: every number is in the row's text.
 */
export function BarList({
  label,
  rows,
  className,
}: {
  /** Names the list for screen readers, e.g. "Tickets by category". */
  label: string;
  rows: readonly BarListRow[];
  className?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className={cn("flex flex-col gap-1", className)}>
      {rows.map((r) => (
        <li key={r.key} className="relative flex min-h-9 items-center gap-3 px-3 text-sm">
          <svg aria-hidden="true" focusable="false" className="absolute inset-0 size-full">
            <rect
              width={`${max > 0 ? Math.max(0.5, (r.value / max) * 100) : 0}%`}
              height="100%"
              rx="6"
              className="fill-muted"
            />
          </svg>
          <span className="relative min-w-0 flex-1 truncate py-1.5">{r.label}</span>
          <span className="relative shrink-0 font-medium tabular-nums">{r.display}</span>
          {r.detail !== undefined && (
            <span className="text-muted-foreground relative w-10 shrink-0 text-right text-xs tabular-nums">
              {r.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
