"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { SlidingIndicator } from "@/components/sliding-indicator";
import { cn } from "@/lib/utils";
import { AreaChart, type ChartFormat, type ChartPoint } from "./area-chart";
import type { Trend } from "./scale";

/** Literal classes, so Tailwind can see them. */
const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
const TREND_ICONS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

export interface Metric {
  id: string;
  label: string;
  /** Already formatted, e.g. "1,204" or "$0.18". */
  value: string;
  /** "Last 15 days: up 23% vs the 15 before" (scale.ts changeSummary), if the period splits. */
  change: { text: string; trend: Trend } | null;
  chart: {
    title: string;
    data: ChartPoint[];
    valueHeader: string;
    unit: string;
    format?: ChartFormat;
    /** The last day is today, still being counted (drawn dashed). */
    partialLast?: boolean;
  };
}

/**
 * Big metric tabs over one large chart, as on Vercel's analytics: each tab is a number with its
 * change, and choosing it switches the chart below (WAI-ARIA tabs: arrow keys move between them,
 * activation follows focus). Change sentences stay neutral in colour: more tickets or tokens is
 * neither good nor bad by itself.
 */
export function MetricTabs({ label, metrics }: { label: string; metrics: Metric[] }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const current = metrics[selected] ?? metrics[0];
  if (!current) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = metrics.length - 1;
    const next =
      e.key === "ArrowRight"
        ? selected === last
          ? 0
          : selected + 1
        : e.key === "ArrowLeft"
          ? selected === 0
            ? last
            : selected - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("group/ind relative grid border-b", COLS[metrics.length] ?? "grid-cols-3")}
      >
        <SlidingIndicator variant="overline" className="bg-foreground z-[1]" />
        {metrics.map((m, i) => {
          const on = i === selected;
          const Icon = m.change ? TREND_ICONS[m.change.trend] : null;
          return (
            <button
              key={m.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${m.id}`}
              aria-selected={on}
              aria-controls={`${base}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(i)}
              className={cn(
                "focus-visible:ring-ring relative flex min-w-0 flex-col items-start gap-0.5 px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset sm:px-5 sm:py-4",
                i > 0 && "border-l",
                on ? "bg-card" : "bg-muted/40 hover:bg-muted/70",
              )}
            >
              {on && (
                <span
                  aria-hidden="true"
                  className="bg-foreground absolute inset-x-0 top-0 h-0.5 group-data-[ind-ready]/ind:hidden"
                />
              )}
              <span className="text-muted-foreground truncate text-xs sm:text-sm">{m.label}</span>
              <span
                className={cn(
                  "text-lg font-semibold tracking-tight tabular-nums sm:text-2xl",
                  !on && "text-foreground/80",
                )}
              >
                {m.value}
              </span>
              {m.change && Icon && (
                <span className="text-muted-foreground hidden items-start gap-1 text-xs leading-4 sm:flex">
                  <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span>{m.change.text}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${current.id}`}
        // Room above the plot for the tooltip, so it never sits on the tabs.
        className={cn("px-4 pb-4 sm:px-6 sm:pt-12 sm:pb-6", current.change ? "pt-4" : "pt-10")}
      >
        {/* Phones: the tabs show label and number only; the chosen one's change sits here. */}
        {current.change && (
          <p className="text-muted-foreground mb-6 text-xs sm:hidden">{current.change.text}</p>
        )}
        <AreaChart key={current.id} {...current.chart} className="h-56 sm:h-72" />
      </div>
    </div>
  );
}
