"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField, useFocusFirstInvalid } from "@/components/form-field";
import { FormSection } from "@/components/form-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { fieldErrors, patchJson } from "@/lib/api-client";
import { normalizeCategory, SETTINGS_LIMITS as L } from "@/server/modules/settings/limits";
import {
  categoryProblem,
  changesToSave,
  type EditableSettings,
  errorsByField,
  type Fields,
  isDirty,
  minScoreHint,
  toFields,
} from "./ai-settings-fields";
import { CategoryEditor } from "./category-editor";

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
    const problem = categoryProblem(value, fields.categories);
    setCategoryError(problem);
    if (problem) return;
    set("categories", [...fields.categories, value]);
    setNewCategory("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSaved("");
    setConflict(false);

    const { errors: local, patch } = changesToSave(fields, baseline);
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
      setErrors(errorsByField(fieldErrors(res.problem)));
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

  function discardChanges() {
    setFields(toFields(baseline));
    setErrors({});
    setMessage("");
    setCategoryError("");
  }

  const dirty = isDirty(fields, baseline);

  // Leaving with unsaved changes: the browser asks first (its own wording; there is no custom text).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form ref={formRef} method="post" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormAlert message={message} />
      <FormAlert message={saved} tone="success" />
      {conflict && (
        <Button type="button" variant="outline" className="self-start" onClick={() => router.refresh()}>
          Load latest values
        </Button>
      )}

      <div className="flex flex-col">
        <FormSection
          id="ai-features"
          title="AI features"
          description="One switch for everything that sends ticket content to the AI."
        >
          <AiSwitch checked={fields.aiEnabled} onChange={(on) => set("aiEnabled", on)} />
        </FormSection>

        <FormSection id="ai-budget" title="Budget" description="A monthly ceiling on AI use, in tokens.">
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
        </FormSection>

        <FormSection
          id="ai-triage"
          title="Triage"
          description="How new tickets get a category and a priority."
        >
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

          <CategoryEditor
            categories={fields.categories}
            listError={errors.categories}
            newCategory={newCategory}
            addError={categoryError}
            onNewCategoryChange={setNewCategory}
            onAdd={addCategory}
            onRemove={(c) =>
              set(
                "categories",
                fields.categories.filter((x) => x !== c),
              )
            }
          />
        </FormSection>

        <FormSection
          id="ai-drafts"
          title="Reply drafts"
          description="When a draft is refused because no help article matches well enough."
        >
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
            hint={minScoreHint(initial.retrievalMinScoreApplies)}
          />
        </FormSection>
      </div>

      <SaveBar dirty={dirty} pending={pending} onDiscard={discardChanges} />
    </form>
  );
}

/** A native checkbox drawn as a switch: same keyboard and form behaviour. */
function AiSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id="aiEnabled"
        type="checkbox"
        role="switch"
        className="bg-input checked:bg-primary focus-visible:ring-ring focus-visible:ring-offset-background before:bg-background relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:shadow-sm before:transition-transform checked:before:translate-x-5 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:before:transition-none"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby="aiEnabled-hint"
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="aiEnabled">Use AI for triage and reply drafts</Label>
        <p id="aiEnabled-hint" className="text-muted-foreground text-sm">
          When off, no ticket content is sent to the AI. Reading, replying and notes keep working.
        </p>
      </div>
    </div>
  );
}

/**
 * Save, and with unsaved changes a Discard button. The row then sticks to the bottom of the screen
 * (design step 9.5), so Save and Discard are in reach anywhere on this long page.
 */
function SaveBar({ dirty, pending, onDiscard }: { dirty: boolean; pending: boolean; onDiscard: () => void }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3",
        dirty
          ? "glass land-shadow-sm land-pop sticky bottom-3 z-10 rounded-xl border px-4 py-3"
          : "border-t pt-5",
      )}
    >
      {dirty && !pending && (
        <span className="text-foreground mr-auto flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className="bg-warning-strong size-1.5 rounded-full" />
          Unsaved changes
        </span>
      )}
      <Button type="submit" size="lg" className="h-10" pending={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
      {dirty && !pending && (
        <Button type="button" variant="ghost" size="lg" className="h-10" onClick={onDiscard}>
          Discard changes
        </Button>
      )}
    </div>
  );
}
