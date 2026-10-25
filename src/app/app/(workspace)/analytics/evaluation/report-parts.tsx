import { Check, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EvalProvider } from "@/server/modules/eval/constants";

/** Small building blocks shared by the parts of the evaluation report. */

export const PROVIDER_LABELS: Record<EvalProvider, string> = { gemini: "Gemini", mock: "Mock" };

export const STATUS: Record<string, { label: string; variant: "secondary" | "outline" }> = {
  completed: { label: "Complete", variant: "secondary" },
  stopped: { label: "Partial", variant: "outline" },
  running: { label: "Running or interrupted", variant: "outline" },
};

export const th = "px-3 py-2 font-medium whitespace-nowrap";
export const td = "px-3 py-2";

/** A titled part of the report: heading, optional description, content. Space and a hairline, not a card. */
export function Block({
  id,
  title,
  description,
  level = 2,
  bodyClassName,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  level?: 2 | 3;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-3">
      <div className="border-b pb-2">
        <Heading
          id={`${id}-heading`}
          className={level === 3 ? "text-sm font-semibold" : "text-base font-semibold"}
        >
          {title}
        </Heading>
        {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
      </div>
      <div className={bodyClassName ?? "flex flex-col gap-3"}>{children}</div>
    </section>
  );
}

export function RunFigure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {detail && <dd className="text-muted-foreground text-xs">{detail}</dd>}
    </div>
  );
}

/**
 * Met / Not met / No data for a metric with a target. Hidden from screen readers: the line under
 * the number already says "target ≥ 85% · met", so this only repeats it visually.
 */
export function TargetChip({ meets }: { meets: boolean | null | undefined }) {
  if (meets === undefined) return null;
  const [Icon, label, tone] =
    meets === true
      ? [Check, "Met", "border-success-border bg-success-subtle text-success-strong"]
      : meets === false
        ? [X, "Not met", "border-danger-border bg-danger-subtle text-danger-strong"]
        : [Minus, "No data", "border-border text-muted-foreground"];
  return (
    <Badge aria-hidden="true" variant="outline" className={`gap-1 ${tone}`}>
      <Icon />
      {label}
    </Badge>
  );
}
