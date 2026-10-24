import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level building blocks shared by the workspace pages (design system step 4): one header
 * pattern, stat tiles, section cards and a tab bar, so every page reads the same way.
 */

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A grid of stat tiles. It is a <dl>, so each tile is a term (label) and a definition (value). */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</dl>;
}

const TONE: Record<"neutral" | "brand" | "success" | "warning" | "danger", string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand-subtle text-brand-strong",
  success: "bg-success-subtle text-success-strong",
  warning: "bg-warning-subtle text-warning-strong",
  danger: "bg-danger-subtle text-danger-strong",
};

export function Stat({
  label,
  value,
  href,
  srSuffix,
  icon: Icon,
  tone = "neutral",
  note,
  chart,
}: {
  label: string;
  value: React.ReactNode;
  /** Makes the number a link (with `srSuffix` read after it, e.g. "open tickets"). */
  href?: string;
  srSuffix?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONE;
  /** One short line under the number. */
  note?: React.ReactNode;
  /** A decorative chart under the number, e.g. a sparkline (its data must be on the page as text). */
  chart?: React.ReactNode;
}) {
  return (
    <div className="bg-card relative flex flex-col gap-1.5 rounded-xl border p-4">
      <dt className="text-muted-foreground flex items-center gap-2 text-sm">
        {Icon && (
          <span className={cn("inline-flex size-6 items-center justify-center rounded-md", TONE[tone])}>
            <Icon aria-hidden="true" className="size-3.5" />
          </span>
        )}
        {label}
      </dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">
        {href ? (
          <Link
            href={href}
            className="focus-visible:ring-ring rounded-xl after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:outline-none focus-visible:after:ring-2"
          >
            {value}
            {srSuffix && <span className="sr-only"> {srSuffix}</span>}
          </Link>
        ) : (
          value
        )}
      </dd>
      {/* A second definition, not a <p>: a <dl> group may only contain <dt> and <dd>. */}
      {note && <dd className="text-muted-foreground text-xs">{note}</dd>}
      {chart && <dd className="mt-auto pt-1">{chart}</dd>}
    </div>
  );
}

/** A titled card section: title (h2), optional description and actions, then content. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  level = 2,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  /** Heading level of the title; 3 for sections nested under another section's h2. */
  level?: 2 | 3;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("bg-card text-card-foreground min-w-0 rounded-xl border", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="min-w-0">
          {/* tabIndex -1: a place to move focus to when the control that had it goes away. */}
          <Heading
            id={headingId}
            tabIndex={headingId ? -1 : undefined}
            className="text-sm font-semibold outline-none"
          >
            {title}
          </Heading>
          {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** An empty state: icon, one line, optional explanation and next action. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <span className="bg-muted text-muted-foreground inline-flex size-10 items-center justify-center rounded-full">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted-foreground max-w-sm text-sm">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** Underlined tabs between sibling pages (a nav of links, `aria-current="page"` on the current one). */
export function TabNav({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: { href: string; label: React.ReactNode; value: string }[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((t) => {
          const here = t.value === current;
          return (
            <li key={t.value}>
              <Link
                href={t.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:text-foreground -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm",
                  here && "border-foreground text-foreground font-medium",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
