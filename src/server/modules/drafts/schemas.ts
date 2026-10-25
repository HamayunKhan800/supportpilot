import { z } from "zod";

import { LIMITS } from "@/server/modules/tickets/limits";
import { DRAFT_FEEDBACK, DRAFT_FEEDBACK_REASONS } from "@/server/platform/db/schema";
import { stripNul } from "@/server/platform/text";

/** Request bodies for the draft actions (M5 FR-AI5, FR-AI6). */

export const draftSendInput = z.object({
  /** The agent's edited text. `[n]` markers are removed before it is posted (D9). */
  body: z.string().max(LIMITS.message, `Reply must be at most ${LIMITS.message} characters.`),
});

export const draftFeedbackInput = z.object({
  rating: z.enum(DRAFT_FEEDBACK),
  /** Only kept with a thumbs-down. */
  reason: z.enum(DRAFT_FEEDBACK_REASONS).optional(),
  note: z
    .string()
    .transform((s) => stripNul(s).trim())
    .pipe(z.string().max(500, "Keep the note under 500 characters."))
    .optional(),
});
