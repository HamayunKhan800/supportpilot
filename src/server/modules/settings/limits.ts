/**
 * Allowed values for the AI settings page (M5 step 5). Client-safe: the form and the API use the
 * same numbers. The database has looser CHECK constraints as a backstop (migration 0008).
 */
export const SETTINGS_LIMITS = {
  /** Tokens per calendar month (UTC), triage and drafts combined. 0 pauses AI generation. */
  budget: { min: 0, max: 100_000_000 },
  /**
   * Triage labels at or above this confidence are applied automatically (M5 D5). Below 0.5 the
   * model is guessing more often than not, so the page does not allow it.
   */
  threshold: { min: 0.5, max: 1, step: 0.05 },
  /**
   * Cosine similarity a passage needs before a draft is attempted (M5 D7). The scale is Gemini
   * embeddings' (gemini-embedding-2): the eval put relevant passages well above 0.65 (finding
   * #87). 0 turns the gate off; above 0.95 would refuse almost everything.
   */
  minScore: { min: 0, max: 0.95, step: 0.01 },
  categories: { min: 1, max: 20, maxLength: 32 },
} as const;

/** Lower-case words joined by single hyphens, e.g. "billing" or "feature-request". */
export const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turns what an admin typed into a category id: "Feature Request" → "feature-request".
 * Returns "" when nothing usable is left. The API validates the result again.
 */
export function normalizeCategory(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
