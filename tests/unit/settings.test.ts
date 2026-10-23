import { describe, expect, it } from "vitest";

import { CATEGORY_PATTERN, normalizeCategory, SETTINGS_LIMITS } from "@/server/modules/settings/limits";
import { aiSettingsPatchInput } from "@/server/modules/settings/schemas";
import { DEFAULT_CATEGORIES } from "@/server/platform/auth/workspace-settings";

describe("normalizeCategory", () => {
  it.each([
    ["Billing", "billing"],
    ["  Feature Request  ", "feature-request"],
    ["how_to", "how-to"],
    ["Refunds & Returns", "refunds-returns"],
    ["--edge--case--", "edge-case"],
    ["ＢＩＬＬＩＮＧ", "billing"], // full-width letters (NFKC)
    ["2FA", "2fa"],
    ["!!!", ""],
    ["", ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeCategory(input)).toBe(expected);
  });

  it("always produces a valid category or nothing", () => {
    for (const s of ["Café menu", "a  b", "x-", "ÆØÅ", "émoji 🎉 time", "UPPER_lower-Mixed 9"]) {
      const out = normalizeCategory(s);
      if (out !== "") expect(out).toMatch(CATEGORY_PATTERN);
    }
  });

  it("the default categories are all valid", () => {
    for (const c of DEFAULT_CATEGORIES) expect(c).toMatch(CATEGORY_PATTERN);
    expect(DEFAULT_CATEGORIES.length).toBeLessThanOrEqual(SETTINGS_LIMITS.categories.max);
  });
});

describe("aiSettingsPatchInput", () => {
  const ok = (body: unknown) => aiSettingsPatchInput.safeParse(body).success;

  it("needs a version and at least one change", () => {
    expect(ok({ monthlyTokenBudget: 5 })).toBe(false);
    expect(ok({ version: 1 })).toBe(false);
    expect(ok({ version: 0, monthlyTokenBudget: 5 })).toBe(false);
    expect(ok({ version: 1, monthlyTokenBudget: 5 })).toBe(true);
  });

  it("rejects fields the page does not offer (no mass assignment)", () => {
    expect(ok({ version: 1, aiEnabled: true, workspaceId: "x" })).toBe(false);
    expect(ok({ version: 1, aiEnabled: true, updatedAt: "2026-01-01" })).toBe(false);
  });

  it("accepts each range's edges and refuses just outside them", () => {
    const { budget, threshold, minScore } = SETTINGS_LIMITS;
    expect(ok({ version: 1, monthlyTokenBudget: budget.min })).toBe(true);
    expect(ok({ version: 1, monthlyTokenBudget: budget.max })).toBe(true);
    expect(ok({ version: 1, monthlyTokenBudget: budget.max + 1 })).toBe(false);
    expect(ok({ version: 1, triageConfidenceThreshold: threshold.min })).toBe(true);
    expect(ok({ version: 1, triageConfidenceThreshold: threshold.max })).toBe(true);
    expect(ok({ version: 1, triageConfidenceThreshold: 0.49 })).toBe(false);
    expect(ok({ version: 1, retrievalMinScore: minScore.min })).toBe(true);
    expect(ok({ version: 1, retrievalMinScore: minScore.max })).toBe(true);
    expect(ok({ version: 1, retrievalMinScore: 0.951 })).toBe(false);
    expect(ok({ version: 1, triageConfidenceThreshold: Number.NaN })).toBe(false);
    expect(ok({ version: 1, monthlyTokenBudget: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("is idempotent, so the route and the service can both parse it (findings #79, #84)", () => {
    const body = {
      version: 3,
      aiEnabled: false,
      monthlyTokenBudget: 0,
      triageConfidenceThreshold: 0.7000000001,
      retrievalMinScore: 0.655,
      categories: ["billing", "refunds"],
    };
    const once = aiSettingsPatchInput.parse(body);
    expect(aiSettingsPatchInput.parse(once)).toEqual(once);
    expect(once.triageConfidenceThreshold).toBe(0.7);
  });
});
