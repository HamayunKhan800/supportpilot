import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The compact top bar of an app page (design step 9.5), the way Linear and Plain head a view:
 * a small title, an optional count and breadcrumb, and actions on the right, in a bar that stays
 * at the top while the page scrolls. The help text sits below it, not in it. It must be the first
 * child of the page's column: it pulls itself up and out to the edges of <main>, and sticks
 * within that column. Under the mobile header (lg:hidden, 3.5rem) it sticks just below it.
 */
export function PageHeader({
  title,
  description,
  actions,
  count,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** A number shown after the title, e.g. how many items the view holds. */
  count?: React.ReactNode;
  /** A link to the parent page, shown before the title. */
  breadcrumb?: { href: string; label: string };
}) {
  return (
    <>
      <div
        data-page-bar
        className="page-bar glass-bar sticky top-14 z-30 -mx-4 -mt-8 flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {breadcrumb && (
            <>
              <Link
                href={breadcrumb.href}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm text-sm transition-colors"
              >
                {breadcrumb.label}
              </Link>
              <ChevronRight aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
            </>
          )}
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">{title}</h1>
          {count != null && <span className="text-muted-foreground text-sm tabular-nums">{count}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-muted-foreground -mt-4 max-w-prose text-sm">{description}</p>}
    </>
  );
}

/**
 * A row of stats in one bordered strip with hairline dividers (as on Vercel's and Stripe's
 * dashboards), not separate cards with icon tiles (design step 7). It is a <dl>, so each stat is
 * a term (label) and a definition (value).
 */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        "bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** A small status dot before the label when the number carries a meaning; the label says it in words. */
const TONE: Record<"neutral" | "brand" | "success" | "warning" | "danger", string | null> = {
  neutral: null,
  brand: null,
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Stat({
  label,
  value,
  href,
  srSuffix,
  tone = "neutral",
  note,
  chart,
}: {
  label: string;
  value: React.ReactNode;
  /** Makes the number a link (with `srSuffix` read after it, e.g. "open tickets"). */
  href?: string;
  srSuffix?: string;
  tone?: keyof typeof TONE;
  /** One short line under the number. */
  note?: React.ReactNode;
  /** A decorative chart under the number, e.g. a sparkline (its data must be on the page as text). */
  chart?: React.ReactNode;
}) {
  return (
    <div className="bg-card relative flex flex-col gap-1.5 p-4">
      <dt className="text-muted-foreground flex items-center gap-2 text-sm">
        {TONE[tone] && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE[tone])} />}
        {label}
      </dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">
        {href ? (
          <Link
            href={href}
            className="focus-visible:after:ring-ring after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
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
          {description && <p className="text-muted-foreground mt-0.5 max-w-prose text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** An empty state: a plain icon (no tile), one line, optional explanation and next action. */
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
      <Icon aria-hidden="true" className="text-muted-foreground size-5" />
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
