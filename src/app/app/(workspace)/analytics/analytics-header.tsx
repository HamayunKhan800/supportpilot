import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "usage", href: "/app/analytics", label: "Usage" },
  { key: "evaluation", href: "/app/analytics/evaluation", label: "Evaluation" },
] as const;

/** Page heading plus the Usage / Evaluation switch, shared by both analytics pages. */
export function AnalyticsHeader({
  current,
  intro,
}: {
  current: (typeof TABS)[number]["key"];
  intro: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">{intro}</p>
      </div>
      <nav aria-label="Analytics">
        <ul className="flex gap-1 border-b">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={t.key === current ? "page" : undefined}
                className={cn(
                  "hover:text-foreground -mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm",
                  t.key === current
                    ? "border-foreground font-medium"
                    : "text-muted-foreground border-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** A row of links that pick one option (period, provider), the current one marked for screen readers. */
export function OptionLinks({
  label,
  options,
}: {
  label: string;
  options: readonly { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1">
        {options.map((o) => (
          <li key={o.href}>
            <Link
              href={o.href}
              aria-current={o.current ? "true" : undefined}
              className={cn(
                "hover:bg-muted inline-flex h-9 items-center rounded-md border px-3 text-sm",
                o.current && "bg-muted border-foreground font-medium",
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

/** A labelled number, as on the Overview page. */
export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-muted-foreground text-sm">
        {label}
        {detail && <span className="block text-xs">{detail}</span>}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
