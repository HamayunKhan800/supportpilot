import type { TicketPriority } from "@/server/modules/tickets/types";

/**
 * Default auto-apply threshold for new workspaces (admins can change it on the AI settings page).
 * 0.95 from the M6 Gemini baseline (docs/eval/m6-baseline.md, finding 1): at the earlier 0.7 the
 * model rated 149 of 150 test tickets above the bar, so all 19 wrong categories were applied
 * without review; at 0.95, 22% went to a person and 13 of the 19 were caught. Read off the same
 * 150 tickets, so it should be re-checked on new data.
 */
export const DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD = 0.95;

/**
 * D5, "triage never overwrites a human", as a pure function. A label is written to the
 * ticket only when all of these hold:
 *  - the model is confident enough (confidence ≥ the workspace threshold),
 *  - the run isn't flagged (e.g. hidden characters were removed from the message),
 *  - no agent has set that field,
 *  - the value would actually change.
 * Any suggestion that differs from the ticket but wasn't applied means "Needs review".
 */
export interface TriageDecisionInput {
  suggestion: { category: string; priority: TicketPriority; confidence: number };
  current: { category: string | null; priority: TicketPriority };
  humanSet: { category: boolean; priority: boolean };
  threshold: number;
  flagged: boolean;
}

export interface TriageDecision {
  applyCategory: boolean;
  applyPriority: boolean;
  needsReview: boolean;
}

export function decideTriage(input: TriageDecisionInput): TriageDecision {
  const { suggestion, current, humanSet } = input;
  const mayApply = !input.flagged && suggestion.confidence >= input.threshold;

  const categoryDiffers = suggestion.category !== current.category;
  const priorityDiffers = suggestion.priority !== current.priority;
  const applyCategory = mayApply && !humanSet.category && categoryDiffers;
  const applyPriority = mayApply && !humanSet.priority && priorityDiffers;

  return {
    applyCategory,
    applyPriority,
    needsReview: (categoryDiffers && !applyCategory) || (priorityDiffers && !applyPriority),
  };
}
