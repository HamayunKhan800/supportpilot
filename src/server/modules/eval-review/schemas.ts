import { z } from "zod";

import { REVIEW_NOTE_MAX, REVIEW_VERDICTS } from "./content";

/** POST /api/internal/review/items/{id}/verdict */
export const reviewVerdictInput = z.strictObject({
  /** The content the reviewer saw; a mismatch means the item changed since (409). */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "Invalid content hash."),
  verdict: z.enum(REVIEW_VERDICTS),
  note: z
    .string()
    .trim()
    .max(REVIEW_NOTE_MAX, `Notes are limited to ${REVIEW_NOTE_MAX} characters.`)
    // nullish, so parsing an already-parsed body again gives the same result (cf. #79/#84).
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const reviewItemIdParams = z.strictObject({ id: z.uuid() });

export const ReviewVerdictSaved = z.strictObject({
  itemKey: z.string(),
  verdict: z.enum(REVIEW_VERDICTS),
  note: z.string().nullable(),
  reviewedAt: z.string(),
  /** The next item still to review in this set, after this one (wrapping); null when done. */
  nextUnreviewedKey: z.string().nullable(),
  reviewed: z.number().int(),
  total: z.number().int(),
});
export type ReviewVerdictSaved = z.infer<typeof ReviewVerdictSaved>;
