import { describe, expect, it } from "vitest";
import {
  categoryProblem,
  changesToSave,
  type EditableSettings,
  errorsByField,
  isDirty,
  minScoreHint,
  toFields,
} from "@/app/app/(workspace)/settings/ai-settings-fields";

/**
 * The decisions inside the AI settings form: what counts as a change, what is sent, and the messages.
 * Pinned before the form was split into smaller components (architecture audit, UI round).
 */

const saved: EditableSettings = {
  version: 7,
  aiEnabled: true,
  monthlyTokenBudget: 500000,
  triageConfidenceThreshold: 0.95,
  retrievalMinScore: 0.62,
  retrievalMinScoreApplies: true,
  categories: ["billing", "bug"],
};

describe("toFields", () => {
  it("turns the numbers into the strings the inputs edit", () => {
    expect(toFields(saved)).toEqual({
      aiEnabled: true,
      monthlyTokenBudget: "500000",
      triageConfidenceThreshold: "0.95",
      retrievalMinScore: "0.62",
      categories: ["billing", "bug"],
    });
  });
});

describe("changesToSave", () => {
  it("sends only what changed, as numbers", () => {
    const fields = { ...toFields(saved), monthlyTokenBudget: " 1000 ", aiEnabled: false };
    expect(changesToSave(fields, saved)).toEqual({
      errors: {},
      patch: { monthlyTokenBudget: 1000, aiEnabled: false },
    });
  });

  it("treats a number typed differently but equal (0.950) as unchanged", () => {
    expect(changesToSave({ ...toFields(saved), triageConfidenceThreshold: "0.950" }, saved).patch).toEqual(
      {},
    );
  });

  it("sends the whole category list when its order or content changed", () => {
    const fields = { ...toFields(saved), categories: ["bug", "billing"] };
    expect(changesToSave(fields, saved).patch).toEqual({ categories: ["bug", "billing"] });
  });

  it("flags empty and non-numeric number fields", () => {
    const fields = { ...toFields(saved), monthlyTokenBudget: "  ", retrievalMinScore: "abc" };
    expect(changesToSave(fields, saved).errors).toEqual({
      monthlyTokenBudget: "Enter a number.",
      retrievalMinScore: "Enter a number.",
    });
  });

  it("finds nothing to send when nothing changed", () => {
    expect(changesToSave(toFields(saved), saved)).toEqual({ errors: {}, patch: {} });
  });
});

describe("isDirty", () => {
  it("is false for the saved values, ignoring spaces around numbers", () => {
    expect(isDirty(toFields(saved), saved)).toBe(false);
    expect(isDirty({ ...toFields(saved), monthlyTokenBudget: " 500000 " }, saved)).toBe(false);
  });

  it("compares the text typed, so 0.950 counts as an unsaved change", () => {
    expect(isDirty({ ...toFields(saved), triageConfidenceThreshold: "0.950" }, saved)).toBe(true);
  });

  it("notices the switch and the categories", () => {
    expect(isDirty({ ...toFields(saved), aiEnabled: false }, saved)).toBe(true);
    expect(isDirty({ ...toFields(saved), categories: ["billing"] }, saved)).toBe(true);
  });
});

describe("categoryProblem", () => {
  it("accepts a new, valid name", () => {
    expect(categoryProblem("feature-request", ["billing"])).toBe("");
  });

  it("explains each problem, in this order", () => {
    expect(categoryProblem("", [])).toBe("Type a name using letters or numbers.");
    expect(categoryProblem("x".repeat(33), [])).toBe("Keep each category under 32 characters.");
    expect(categoryProblem("billing", ["billing"])).toBe("“billing” is already a category.");
    const full = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(categoryProblem("new", full)).toBe("Use at most 20 categories.");
  });
});

describe("errorsByField", () => {
  it("shows a problem with one list item on the list, keeping the first message", () => {
    expect(
      errorsByField({
        "categories.2": "Too long",
        "categories.4": "Duplicate",
        monthlyTokenBudget: "Too big",
      }),
    ).toEqual({ categories: "Too long", monthlyTokenBudget: "Too big" });
  });
});

describe("minScoreHint", () => {
  it("adds the demo-embedder caveat only when the setting is not used", () => {
    expect(minScoreHint(true)).toMatch(/^Drafts are refused without an AI call .*fell below\.$/);
    expect(minScoreHint(false)).toMatch(/fell below\. This deployment uses the offline demo embedder,/);
  });
});
