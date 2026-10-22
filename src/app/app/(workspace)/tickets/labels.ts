import type { TicketPriority, TicketStatus } from "@/server/modules/tickets/types";

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Text + border colours that pass WCAG AA contrast on white. */
export const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: "border-zinc-300 text-zinc-700",
  normal: "border-zinc-300 text-zinc-700",
  high: "border-orange-300 text-orange-800",
  urgent: "border-red-300 bg-red-50 text-red-800",
};

export const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const selectClass = "border-input bg-background h-10 w-full min-w-0 rounded-md border px-2 text-sm";
