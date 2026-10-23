/**
 * Number formatting for the dashboard (M6 step 5). Fixed locale (en-US) and UTC, so the server
 * render, tests and screenshots always agree. Missing values read "no data", never 0.
 */

export const NO_DATA = "no data";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatCount(n: number): string {
  return integer.format(n);
}

/** 0.873 → "87%"; with digits = 1 → "87.3%". */
export function formatShare(share: number | null, digits = 0): string {
  if (share === null || !Number.isFinite(share)) return NO_DATA;
  return `${(share * 100).toFixed(digits)}%`;
}

/** part of whole as a percentage, or "no data" when whole is 0. */
export function formatRatio(part: number, whole: number): string {
  return whole > 0 ? formatShare(part / whole) : NO_DATA;
}

/** 850 → "850 ms"; 1234 → "1.2 s"; 64800 → "64.8 s". */
export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return NO_DATA;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * US dollars with enough digits to show small AI costs: "$0.0042", "$1.25". Amounts under a
 * hundredth of a cent read "under $0.0001" rather than a misleading "$0.0000".
 */
export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return NO_DATA;
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "under $0.0001";
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export const formatMicros = (micros: number | null) => formatUsd(micros === null ? null : micros / 1e6);

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-10-23" → "23 Oct". Anything else is returned unchanged. */
export function formatDay(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!m) return isoDay;
  return dayFormat.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

const dateTimeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const formatDateTime = (d: Date) => `${dateTimeFormat.format(d)} UTC`;
