/**
 * Compact ages for dense lists ("5m", "3h", "2d", "Oct 3"), with a full phrase for screen
 * readers. The exact time is always in the surrounding <time dateTime> element too.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export interface Age {
  /** What the list shows: "now", "5m", "3h", "2d", "Oct 3", "Oct 2025". */
  short: string;
  /** What a screen reader hears: "just now", "5 minutes ago", "on Oct 3". */
  long: string;
}

export function relativeAge(from: Date, now: Date | number): Age {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diff = Math.max(0, nowMs - from.getTime()); // clock skew never shows "in 2m"
  if (diff < MINUTE) return { short: "now", long: "just now" };
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return { short: `${m}m`, long: plural(m, "minute") };
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return { short: `${h}h`, long: plural(h, "hour") };
  }
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY);
    return { short: `${d}d`, long: plural(d, "day") };
  }
  const sameYear = new Date(nowMs).getUTCFullYear() === from.getUTCFullYear();
  const date = (sameYear ? monthDay : monthYear).format(from);
  return { short: date, long: `on ${date}` };
}
