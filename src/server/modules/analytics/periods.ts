import { EVAL_PROVIDERS, type EvalProvider } from "@/server/modules/eval/constants";

/**
 * The time windows the usage dashboard offers (FR-AN1). A window of N days is today (UTC) plus
 * the N - 1 days before it, so every bar in a daily chart is one whole calendar day.
 */
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = 30;

/** Reads `?days=` from a URL. Anything that isn't exactly one of the offered windows gets the default. */
export function parsePeriod(value: unknown): AnalyticsPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  // Compared as text, so "07" or "7.0" isn't a second address for the 7-day page.
  return ANALYTICS_PERIODS.find((p) => String(p) === raw) ?? DEFAULT_ANALYTICS_PERIOD;
}

/** Reads `?provider=` on the evaluation page: a known provider, or null for "pick for me". */
export function parseProvider(value: unknown): EvalProvider | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return EVAL_PROVIDERS.find((p) => p === raw) ?? null;
}
