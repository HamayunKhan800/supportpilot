import { z } from "zod";

import { CATEGORY_PATTERN, SETTINGS_LIMITS as L } from "./limits";

/** Request body for PATCH /api/v1/settings/ai (M5 step 5). */

/** Two decimals are enough for a threshold; this also drops float noise like 0.7000000001. */
const twoDecimals = (n: number) => Math.round(n * 100) / 100;

const category = z
  .string()
  .max(L.categories.maxLength, `Keep each category under ${L.categories.maxLength} characters.`)
  .regex(CATEGORY_PATTERN, "Use lower-case letters, numbers and single hyphens, e.g. feature-request.");

export const aiSettingsPatchInput = z
  // strict: unknown fields are rejected, so a request can't set columns the page doesn't offer.
  .strictObject({
    /** The version the admin last saw (optimistic concurrency): a stale one returns 409. */
    version: z.int().positive(),
    aiEnabled: z.boolean().optional(),
    monthlyTokenBudget: z
      .int(`Enter a whole number of tokens.`)
      .min(L.budget.min, "The budget can't be negative.")
      .max(L.budget.max, `The budget can be at most ${L.budget.max.toLocaleString("en-US")} tokens.`)
      .optional(),
    triageConfidenceThreshold: z
      .number()
      .min(L.threshold.min, `Choose a threshold from ${L.threshold.min} to ${L.threshold.max}.`)
      .max(L.threshold.max, `Choose a threshold from ${L.threshold.min} to ${L.threshold.max}.`)
      .transform(twoDecimals)
      .optional(),
    retrievalMinScore: z
      .number()
      .min(L.minScore.min, `Choose a score from ${L.minScore.min} to ${L.minScore.max}.`)
      .max(L.minScore.max, `Choose a score from ${L.minScore.min} to ${L.minScore.max}.`)
      .transform(twoDecimals)
      .optional(),
    categories: z
      .array(category)
      .min(L.categories.min, "Keep at least one category: triage needs something to choose from.")
      .max(L.categories.max, `Use at most ${L.categories.max} categories.`)
      .refine((list) => new Set(list).size === list.length, "Each category can appear only once.")
      .optional(),
  })
  .refine((p) => Object.keys(p).some((k) => k !== "version"), { message: "Nothing to update." });

export type AiSettingsPatch = z.infer<typeof aiSettingsPatchInput>;
