import type { TicketPriority } from "@/server/modules/tickets/types";

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
