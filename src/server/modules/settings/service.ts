import { AI_FEATURES } from "@/server/modules/ai/config";
import { insertAuditEvent } from "@/server/platform/auth/audit";
import { requireWorkspace } from "@/server/platform/auth/context";
import { can } from "@/server/platform/auth/permissions";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { getEnv } from "@/server/platform/env";
import { Errors } from "@/server/platform/errors";

import * as repo from "./repository";
import { aiSettingsPatchInput } from "./schemas";

/**
 * The workspace AI settings page (M5 step 5, FR-AI7): AI on/off, the monthly token budget and
 * this month's usage, the triage auto-apply threshold, the refusal floor and the categories.
 * Every member can read it (`settings:read`); admins and owners can change it (`settings:update`).
 */

export interface ApiAiSettings {
  version: number;
  aiEnabled: boolean;
  monthlyTokenBudget: number;
  triageConfidenceThreshold: number;
  retrievalMinScore: number;
  /**
   * False when this deployment uses the offline mock embedder, which has its own fixed floor
   * (finding #89): the setting is on the Gemini embedding scale and only applies with Gemini.
   */
  retrievalMinScoreApplies: boolean;
  categories: string[];
  updatedAt: string;
}

export interface ApiAiUsage {
  since: string;
  /** Triage and draft tokens this month: what the budget counts. */
  budgetTokensUsed: number;
  features: {
    feature: repo.UsageFeature;
    /** Embeddings are tracked but not counted against the budget (see ai/repository.ts). */
    countsTowardBudget: boolean;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    /** What the same calls would cost at paid-tier list prices, US dollars. */
    estimatedCostUsd: number;
    outcomes: repo.FeatureUsage["outcomes"];
  }[];
}

export interface ApiAiSettingsView {
  settings: ApiAiSettings;
  usage: ApiAiUsage;
}

const BUDGET_FEATURES: readonly string[] = AI_FEATURES;

function apiSettings(row: repo.SettingsRow): ApiAiSettings {
  return {
    version: row.version,
    aiEnabled: row.aiEnabled,
    monthlyTokenBudget: row.monthlyTokenBudget,
    triageConfidenceThreshold: row.triageConfidenceThreshold,
    retrievalMinScore: row.retrievalMinScore,
    retrievalMinScoreApplies: getEnv().AI_PROVIDER === "gemini",
    categories: row.categories,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function apiUsage(usage: repo.MonthUsage): ApiAiUsage {
  // A fixed order, so the page and API clients see the same layout every time.
  const order: repo.UsageFeature[] = ["triage", "draft", "embed"];
  const features = order.map((feature) => {
    const f = usage.features.find((u) => u.feature === feature);
    return {
      feature,
      countsTowardBudget: BUDGET_FEATURES.includes(feature),
      calls: f?.calls ?? 0,
      inputTokens: f?.inputTokens ?? 0,
      outputTokens: f?.outputTokens ?? 0,
      estimatedCostUsd: (f?.costMicros ?? 0) / 1_000_000,
      outcomes: f?.outcomes ?? {},
    };
  });
  return {
    since: usage.since,
    budgetTokensUsed: features
      .filter((f) => f.countsTowardBudget)
      .reduce((sum, f) => sum + f.inputTokens + f.outputTokens, 0),
    features,
  };
}

async function load(workspaceId: string): Promise<ApiAiSettingsView> {
  const db = getDb().db;
  const [row, usage] = await Promise.all([
    repo.findSettings(db, workspaceId),
    repo.usageThisMonth(db, workspaceId),
  ]);
  // Every workspace gets a settings row when it is created; a missing one is a server fault.
  if (!row) throw new Error(`workspace ${workspaceId} has no settings row`);
  return { settings: apiSettings(row), usage: apiUsage(usage) };
}

export async function getAiSettings(headers: Headers): Promise<ApiAiSettingsView> {
  const ctx = await requireWorkspace(headers, { settings: ["read"] });
  return load(ctx.workspace.id);
}

/** For the page: the same data plus whether the signed-in member may change it. */
export async function getAiSettingsPage(headers: Headers) {
  const ctx = await requireWorkspace(headers, { settings: ["read"] });
  const view = await load(ctx.workspace.id);
  return {
    ...view,
    canEdit: can(ctx.role, { settings: ["update"] }),
    dailyCallLimit: getEnv().AI_DAILY_CALL_LIMIT,
  };
}

/** How a value is written in the audit log (flat strings and numbers only). */
const auditValue = (v: unknown): string | number | boolean =>
  Array.isArray(v) ? v.join(", ") : (v as string | number | boolean);

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/**
 * Changes some settings. Send the `version` you last read; a stale one returns 409, so two
 * admins can't silently overwrite each other. Each changed field gets its own audit entry.
 */
export async function updateAiSettings(headers: Headers, rawInput: unknown): Promise<ApiAiSettingsView> {
  const ctx = await requireWorkspace(headers, { settings: ["update"] });
  const { version, ...patch } = aiSettingsPatchInput.parse(rawInput);
  const ws = ctx.workspace.id;

  await transaction(async (tx) => {
    const current = await repo.lockSettings(tx, ws);
    if (!current) throw new Error(`workspace ${ws} has no settings row`);
    if (current.version !== version) throw staleConflict();

    const changes: repo.SettingsChanges = {};
    for (const [field, value] of Object.entries(patch) as [keyof repo.SettingsChanges, unknown][]) {
      if (value !== undefined && !same(current[field], value)) Object.assign(changes, { [field]: value });
    }
    // Nothing actually changed: no write, no audit entries, and the version stays put.
    if (Object.keys(changes).length === 0) return;

    if (!(await repo.updateSettings(tx, ws, version, changes))) throw staleConflict();
    for (const [field, to] of Object.entries(changes)) {
      await insertAuditEvent(tx, {
        workspaceId: ws,
        actorUserId: ctx.user.id,
        action: "settings.updated",
        targetType: "workspace",
        targetId: ws,
        metadata: {
          field,
          from: auditValue(current[field as keyof repo.SettingsChanges]),
          to: auditValue(to),
        },
      });
    }
  });
  return load(ws);
}

const staleConflict = () =>
  Errors.conflict("Someone else changed these settings. Reload to see the latest values.", "settings_stale");
