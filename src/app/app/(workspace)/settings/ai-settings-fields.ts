import { SETTINGS_LIMITS as L } from "@/server/modules/settings/limits";

/** The AI settings form's decisions, kept pure so they are unit-tested (the server validates again). */

export interface EditableSettings {
  version: number;
  aiEnabled: boolean;
  monthlyTokenBudget: number;
  triageConfidenceThreshold: number;
  retrievalMinScore: number;
  retrievalMinScoreApplies: boolean;
  categories: string[];
}

/** The values as the inputs hold them: numbers stay text while they are edited. */
export type Fields = {
  aiEnabled: boolean;
  monthlyTokenBudget: string;
  triageConfidenceThreshold: string;
  retrievalMinScore: string;
  categories: string[];
};

export const toFields = (s: EditableSettings): Fields => ({
  aiEnabled: s.aiEnabled,
  monthlyTokenBudget: String(s.monthlyTokenBudget),
  triageConfidenceThreshold: String(s.triageConfidenceThreshold),
  retrievalMinScore: String(s.retrievalMinScore),
  categories: s.categories,
});

const NUMBER_FIELDS = ["monthlyTokenBudget", "triageConfidenceThreshold", "retrievalMinScore"] as const;

const sameCategories = (a: readonly string[], b: readonly string[]) => a.join("\n") === b.join("\n");

/** What to send (only changed fields) and which number fields cannot be read. */
export function changesToSave(fields: Fields, baseline: EditableSettings) {
  const errors: Record<string, string> = {};
  const patch: Record<string, unknown> = {};
  for (const key of NUMBER_FIELDS) {
    const raw = fields[key].trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) errors[key] = "Enter a number.";
    else if (n !== baseline[key]) patch[key] = n;
  }
  if (fields.aiEnabled !== baseline.aiEnabled) patch.aiEnabled = fields.aiEnabled;
  if (!sameCategories(fields.categories, baseline.categories)) patch.categories = fields.categories;
  return { errors, patch };
}

/** Unsaved changes, by the text typed (what the save bar and the leave-page warning go by). */
export function isDirty(fields: Fields, baseline: EditableSettings): boolean {
  const pristine = toFields(baseline);
  return (
    fields.aiEnabled !== pristine.aiEnabled ||
    NUMBER_FIELDS.some((k) => fields[k].trim() !== pristine[k]) ||
    !sameCategories(fields.categories, pristine.categories)
  );
}

/** Why a (normalized) new category can't be added, or "" when it can. */
export function categoryProblem(value: string, categories: readonly string[]): string {
  if (!value) return "Type a name using letters or numbers.";
  if (value.length > L.categories.maxLength)
    return `Keep each category under ${L.categories.maxLength} characters.`;
  if (categories.includes(value)) return `“${value}” is already a category.`;
  if (categories.length >= L.categories.max) return `Use at most ${L.categories.max} categories.`;
  return "";
}

/** Server field errors by input: array items come back as "categories.2" and show on the list. */
export function errorsByField(byField: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(byField)) merged[k.split(".")[0]!] ??= v;
  return merged;
}

export function minScoreHint(applies: boolean): string {
  return (
    `Drafts are refused without an AI call when no help article scores at least this (0 to ${L.minScore.max}). ` +
    "This is on the Gemini embedding scale (gemini-embedding-2). The default, 0.62, comes from our evaluation: every answerable test question scored above it, and only off-topic ones fell below." +
    (applies
      ? ""
      : " This deployment uses the offline demo embedder, which has its own fixed floor, so this value is saved but not used here.")
  );
}
