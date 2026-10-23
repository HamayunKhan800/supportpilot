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

export const SENTIMENT_LABEL: Record<string, string> = {
  negative: "Negative",
  neutral: "Neutral",
  positive: "Positive",
};

/** Plain-language reasons for a triage run that produced no suggestion. */
export const TRIAGE_ERROR_LABEL: Record<string, string> = {
  ai_disabled: "AI is switched off for this workspace (AI settings).",
  ai_budget_exhausted: "This workspace has used its AI budget for the month (AI settings).",
  ai_daily_limit: "The daily AI limit for this service was reached.",
  no_categories: "This workspace has no categories to choose from.",
  ai_invalid_output: "The AI's answer could not be used.",
  ai_unavailable: "The AI service was unavailable.",
  ai_timeout: "The AI service took too long to answer.",
  ai_rejected: "The AI service refused the request.",
  ai_aborted: "The AI request was cancelled.",
  dead_lettered: "The AI service was unavailable.",
};

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** "es" → "Spanish"; unknown codes are shown as they are. */
export function languageName(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}
