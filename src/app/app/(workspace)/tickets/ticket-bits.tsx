import { CircleCheck, CircleDot, Clock, Flame, Lock } from "lucide-react";
import { relativeAge } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/server/modules/tickets/types";
import { dateFormat, PRIORITY_LABEL, STATUS_LABEL } from "./labels";

/**
 * Small, server-safe pieces shared by the ticket list and the ticket page. Status and priority
 * differ by shape as well as colour (WCAG 1.4.1), and always carry their name in text.
 */

const STATUS_ICON = { open: CircleDot, pending: Clock, resolved: CircleCheck, closed: Lock } as const;
const STATUS_TONE: Record<TicketStatus, string> = {
  open: "text-info-strong",
  pending: "text-warning-strong",
  resolved: "text-success-strong",
  closed: "text-muted-foreground",
};

export function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", STATUS_TONE[status], className)} />;
}

/** Icon + label, e.g. in the ticket header. */
export function StatusLabel({ status }: { status: TicketStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <StatusIcon status={status} />
      <span className="sr-only">Status: </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

const BARS: Record<Exclude<TicketPriority, "urgent">, number> = { low: 1, normal: 2, high: 3 };

/** Signal bars (1–3) for low/normal/high; a flame for urgent. */
export function PriorityIcon({ priority, className }: { priority: TicketPriority; className?: string }) {
  if (priority === "urgent") {
    return <Flame aria-hidden="true" className={cn("text-danger-strong size-4 shrink-0", className)} />;
  }
  const filled = BARS[priority];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        "size-4 shrink-0",
        priority === "high" ? "text-warning-strong" : "text-muted-foreground",
        className,
      )}
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4.5}
          y={10 - i * 3.5}
          width="3"
          height={4 + i * 3.5}
          rx="1"
          fill="currentColor"
          className={i < filled ? undefined : "opacity-25"}
        />
      ))}
    </svg>
  );
}

export function PriorityLabel({ priority, className }: { priority: TicketPriority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        priority === "urgent"
          ? "text-danger-strong font-medium"
          : priority === "high" && "text-warning-strong",
        className,
      )}
    >
      <PriorityIcon priority={priority} />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** Initials in a circle. Decorative: the name is always shown or read next to it. */
export function Avatar({
  name,
  tone = "neutral",
  className,
}: {
  name: string;
  tone?: "neutral" | "brand" | "warning";
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        tone === "brand" && "bg-brand-subtle text-brand-strong",
        tone === "warning" && "bg-warning-subtle text-warning-strong",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** "3h" on screen, "3 hours ago" for screen readers, exact UTC time on hover and in dateTime. */
export function Age({
  date,
  now,
  prefix,
  className,
}: {
  date: Date;
  now: number;
  prefix?: string;
  className?: string;
}) {
  const age = relativeAge(date, now);
  return (
    <time
      dateTime={date.toISOString()}
      title={`${dateFormat.format(date)} UTC`}
      className={cn("text-muted-foreground tabular-nums", className)}
    >
      <span aria-hidden="true">{age.short}</span>
      <span className="sr-only">
        {prefix ? `${prefix} ` : ""}
        {age.long}
      </span>
    </time>
  );
}
