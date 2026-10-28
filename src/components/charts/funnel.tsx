import { ArrowDownRight } from "lucide-react";
import { formatCount, formatRatio } from "@/lib/format";

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** Why items left before the next step, e.g. "2 discarded, 1 still waiting". */
  dropped?: string;
}

/**
 * Steps that each keep part of the one before, as in PostHog's funnels: a bar per step on one
 * scale (the first step is 100%), its count and share of the first, and what dropped out before
 * the next step. Bars are SVG (no inline styles under the CSP) and decorative; an ordered list
 * carries every number for screen readers.
 */
export function Funnel({ label, steps }: { label: string; steps: readonly FunnelStep[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol aria-label={label} className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const next = steps[i + 1];
        const lost = next ? s.value - next.value : 0;
        return (
          <li key={s.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                {s.label}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{formatCount(s.value)}</span>
                {i > 0 && (
                  <span className="text-muted-foreground ml-2 text-xs">{formatRatio(s.value, first)}</span>
                )}
              </span>
            </div>
            <svg aria-hidden="true" focusable="false" width="100%" height="10" className="block">
              <rect width="100%" height="10" rx="3" className="fill-muted" />
              <rect
                width={`${first > 0 ? (s.value / first) * 100 : 0}%`}
                height="10"
                rx="3"
                className="fill-chart-1"
              />
            </svg>
            {next && lost > 0 && (
              <p className="text-muted-foreground flex items-start gap-1 py-1 text-xs">
                <ArrowDownRight aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <span>
                  {formatCount(lost)} left here{s.dropped ? `: ${s.dropped}` : ""}
                </span>
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
