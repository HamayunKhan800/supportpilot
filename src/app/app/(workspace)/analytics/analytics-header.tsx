import Link from "next/link";
import type * as React from "react";
import { PageHeader, TabNav } from "@/components/page";
import { SlidingIndicator } from "@/components/sliding-indicator";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "usage", href: "/app/analytics", label: "Usage" },
  { value: "evaluation", href: "/app/analytics/evaluation", label: "Evaluation" },
] as const;

/** Page heading plus the Usage / Evaluation tabs, shared by both analytics pages. */
export function AnalyticsHeader({
  current,
  intro,
  actions,
}: {
  current: (typeof TABS)[number]["value"];
  intro: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Analytics" description={intro} actions={actions} />
      <TabNav label="Analytics" tabs={[...TABS]} current={current} />
    </div>
  );
}

/**
 * A segmented control of links that pick one option (period, provider). Links, not buttons:
 * each option is a URL that can be shared. The current one is marked for screen readers.
 */
export function OptionLinks({
  label,
  options,
}: {
  label: string;
  options: readonly { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="group/ind relative">
      <SlidingIndicator className="bg-background ring-border rounded-md shadow-xs ring-1" />
      <ul className="bg-muted inline-flex flex-wrap gap-0.5 rounded-lg p-0.5">
        {options.map((o) => (
          <li key={o.href}>
            <Link
              href={o.href}
              aria-current={o.current ? "true" : undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground relative inline-flex h-8 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150",
                o.current &&
                  "bg-background text-foreground ring-border font-medium shadow-xs ring-1 group-data-[ind-ready]/ind:bg-transparent group-data-[ind-ready]/ind:shadow-none group-data-[ind-ready]/ind:ring-0",
              )}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
