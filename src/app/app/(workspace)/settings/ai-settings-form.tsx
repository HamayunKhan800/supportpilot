"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField, useFocusFirstInvalid } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldErrors, patchJson } from "@/lib/api-client";
import { normalizeCategory, SETTINGS_LIMITS as L } from "@/server/modules/settings/limits";

export interface EditableSettings {
  version: number;
  aiEnabled: boolean;
  monthlyTokenBudget: number;
  triageConfidenceThreshold: number;
  retrievalMinScore: number;
  retrievalMinScoreApplies: boolean;
  categories: string[];
}

type Fields = {
  aiEnabled: boolean;
  monthlyTokenBudget: string;
  triageConfidenceThreshold: string;
  retrievalMinScore: string;
  categories: string[];
};

const toFields = (s: EditableSettings): Fields => ({
  aiEnabled: s.aiEnabled,
  monthlyTokenBudget: String(s.monthlyTokenBudget),
  triageConfidenceThreshold: String(s.triageConfidenceThreshold),
  retrievalMinScore: String(s.retrievalMinScore),
  categories: s.categories,
});

const NUMBER_FIELDS = ["monthlyTokenBudget", "triageConfidenceThreshold", "retrievalMinScore"] as const;

/** The AI settings form (M5 step 5). Sends only changed fields, with the version it was loaded at. */
export function AiSettingsForm({ initial }: { initial: EditableSettings }) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [newCategory, setNewCategory] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid(attempt);
  const addHintId = useId();

  // Newer values from the server (after "Load latest values"): start again from them. Adjusting
  // state during render is React's recommended pattern for this (no effect, no extra render).
  const [seenVersion, setSeenVersion] = useState(initial.version);
  if (initial.version !== seenVersion) {
    setSeenVersion(initial.version);
    if (initial.version > baseline.version) {
      setBaseline(initial);
      setFields(toFields(initial));
      setErrors({});
      setMessage("");
      setConflict(false);
      setSaved("Loaded the latest values.");
    }
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  function addCategory() {
    const value = normalizeCategory(newCategory);
    setCategoryError("");
    if (!value) return setCategoryError("Type a name using letters or numbers.");
    if (value.length > L.categories.maxLength) {
      return setCategoryError(`Keep each category under ${L.categories.maxLength} characters.`);
    }
    if (fields.categories.includes(value)) return setCategoryError(`“${value}” is already a category.`);
    if (fields.categories.length >= L.categories.max) {
      return setCategoryError(`Use at most ${L.categories.max} categories.`);
    }
    set("categories", [...fields.categories, value]);
    setNewCategory("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSaved("");
    setConflict(false);

    const local: Record<string, string> = {};
    const patch: Record<string, unknown> = {};
    for (const key of NUMBER_FIELDS) {
      const raw = fields[key].trim();
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n)) local[key] = "Enter a number.";
      else if (n !== baseline[key]) patch[key] = n;
    }
    if (fields.aiEnabled !== baseline.aiEnabled) patch.aiEnabled = fields.aiEnabled;
    if (fields.categories.join("\n") !== baseline.categories.join("\n")) patch.categories = fields.categories;

    if (Object.keys(local).length > 0) {
      setErrors(local);
      setMessage("Please check the highlighted fields.");
      setAttempt((a) => a + 1);
      return;
    }
    if (Object.keys(patch).length === 0) {
      setErrors({});
      setSaved("Nothing to save: no changes.");
      return;
    }

    setPending(true);
    const res = await patchJson<{ settings: EditableSettings }>("/api/v1/settings/ai", {
      version: baseline.version,
      ...patch,
    });
    setPending(false);
    if (!res.ok) {
      const byField = fieldErrors(res.problem);
      // Array items come back as "categories.2"; show them on the category list.
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries(byField)) merged[k.split(".")[0]!] ??= v;
      setErrors(merged);
      setMessage(res.message);
      setConflict(res.problem.status === 409);
      setAttempt((a) => a + 1);
      return;
    }
    setErrors({});
    setBaseline(res.data.settings);
    setFields(toFields(res.data.settings));
    setSeenVersion(res.data.settings.version);
    setSaved("Settings saved.");
    router.refresh(); // usage, budget meter and the read-only parts of the page
  }

  const minScoreHint =
    `Drafts are refused without an AI call when no help article scores at least this (0 to ${L.minScore.max}). ` +
    "This is on the Gemini embedding scale (gemini-embedding-2), where relevant articles scored well above 0.65 in our evaluation." +
    (initial.retrievalMinScoreApplies
      ? ""
      : " This deployment uses the offline demo embedder, which has its own fixed floor, so this value is saved but not used here.");

  return (
    <form ref={formRef} method="post" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormAlert message={message} />
      <FormAlert message={saved} tone="success" />
      {conflict && (
        <Button type="button" variant="outline" className="self-start" onClick={() => router.refresh()}>
          Load latest values
        </Button>
      )}

      <div className="flex items-start gap-3">
        <input
          id="aiEnabled"
          type="checkbox"
          className="accent-primary mt-1 size-5"
          checked={fields.aiEnabled}
          onChange={(e) => set("aiEnabled", e.target.checked)}
          aria-describedby="aiEnabled-hint"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="aiEnabled">Use AI for triage and reply drafts</Label>
          <p id="aiEnabled-hint" className="text-muted-foreground text-sm">
            When off, no ticket content is sent to the AI. Reading, replying and notes keep working.
          </p>
        </div>
      </div>

      <FormField
        label="Monthly token budget"
        name="monthlyTokenBudget"
        type="number"
        inputMode="numeric"
        min={L.budget.min}
        max={L.budget.max}
        step={1}
        value={fields.monthlyTokenBudget}
        onChange={(e) => set("monthlyTokenBudget", e.target.value)}
        error={errors.monthlyTokenBudget}
        hint="Triage and drafts combined, per calendar month (UTC). A draft uses about 4,000 tokens. 0 pauses AI until you raise it."
      />

      <FormField
        label="Auto-apply threshold"
        name="triageConfidenceThreshold"
        type="number"
        inputMode="decimal"
        min={L.threshold.min}
        max={L.threshold.max}
        step={L.threshold.step}
        value={fields.triageConfidenceThreshold}
        onChange={(e) => set("triageConfidenceThreshold", e.target.value)}
        error={errors.triageConfidenceThreshold}
        hint={`Triage labels at or above this confidence (${L.threshold.min} to ${L.threshold.max}) are applied automatically; lower ones wait for an agent as “Needs review”.`}
      />

      <FormField
        label="Minimum match score"
        name="retrievalMinScore"
        type="number"
        inputMode="decimal"
        min={L.minScore.min}
        max={L.minScore.max}
        step={L.minScore.step}
        value={fields.retrievalMinScore}
        onChange={(e) => set("retrievalMinScore", e.target.value)}
        error={errors.retrievalMinScore}
        hint={minScoreHint}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Categories</legend>
        <p className="text-muted-foreground text-sm">
          What triage can choose from and what agents can set. Tickets keep a removed category until someone
          changes it.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Current categories">
          {fields.categories.map((c) => (
            <li key={c} className="bg-muted flex items-center gap-1 rounded-md py-1 pr-1 pl-3 text-sm">
              {c}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label={`Remove ${c}`}
                disabled={fields.categories.length <= L.categories.min}
                onClick={() =>
                  set(
                    "categories",
                    fields.categories.filter((x) => x !== c),
                  )
                }
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        {errors.categories && <p className="text-destructive text-sm">{errors.categories}</p>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newCategory">New category</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="newCategory"
              className="h-10 max-w-xs"
              value={newCategory}
              maxLength={60}
              aria-describedby={categoryError ? `${addHintId} newCategory-error` : addHintId}
              aria-invalid={categoryError ? true : undefined}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // add the category, don't submit the form
                  addCategory();
                }
              }}
            />
            <Button type="button" variant="outline" className="h-10" onClick={addCategory}>
              Add category
            </Button>
          </div>
          <p id={addHintId} className="text-muted-foreground text-sm">
            {newCategory && normalizeCategory(newCategory)
              ? `Will be added as “${normalizeCategory(newCategory)}”.`
              : "Lower-case words joined by hyphens, e.g. feature-request."}
          </p>
          {categoryError && (
            <p id="newCategory-error" className="text-destructive text-sm">
              {categoryError}
            </p>
          )}
        </div>
      </fieldset>

      <Button type="submit" size="lg" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
