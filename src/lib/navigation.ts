/**
 * Pure navigation helpers for the app shell (design system step 2): which sidebar link
 * owns the current page, how links group, and how the command palette matches a query.
 * Kept free of React so the rules are unit-tested.
 */

export const NAV_ICONS = [
  "overview",
  "tickets",
  "knowledge",
  "analytics",
  "evaluation",
  "members",
  "settings",
  "audit",
  "review",
  "account",
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export const NAV_GROUPS = ["work", "insights", "admin"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  work: "Work",
  insights: "Insights",
  admin: "Admin",
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Top-level links (Overview) have no group. */
  group?: NavGroup;
  /** A count shown next to the label, e.g. open tickets. */
  badge?: number;
  /** Extra words the command palette matches, e.g. "inbox" for Tickets. */
  keywords?: string;
}

/**
 * The link that owns `pathname`: an exact match wins; otherwise the longest link that is a
 * section prefix (so /app/analytics/evaluation belongs to Evaluation, not Analytics).
 * "/app" (Overview) only matches exactly.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | undefined {
  if (hrefs.includes(pathname)) return pathname;
  let best: string | undefined;
  for (const href of hrefs) {
    if (href === "/app" || !pathname.startsWith(`${href}/`)) continue;
    if (!best || href.length > best.length) best = href;
  }
  return best;
}

/** Consecutive runs of items that share a group, in their original order. */
export function groupNav<T extends { group?: NavGroup }>(
  items: readonly T[],
): { group: NavGroup | undefined; items: T[] }[] {
  const out: { group: NavGroup | undefined; items: T[] }[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/** "#12", "12" or "ticket 12" → 12. Anything else → undefined. */
export function parseTicketNumber(query: string): number | undefined {
  const match = /^\s*(?:ticket\s*)?#?\s*(\d{1,9})\s*$/i.exec(query);
  if (!match) return undefined;
  const n = Number(match[1]);
  return n > 0 ? n : undefined;
}

export interface Command {
  id: string;
  label: string;
  /** Heading the command is listed under. Groups keep the order of first appearance. */
  group: string;
  keywords?: string;
}

const normalize = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Commands whose label or keywords contain every word of `query` (case- and
 * accent-insensitive). Groups stay in their original order; inside a group, labels that
 * start with the query come first, then labels with a word starting with it.
 */
export function matchCommands<T extends Command>(query: string, commands: readonly T[]): T[] {
  const q = normalize(query.trim());
  if (!q) return [...commands];
  const words = q.split(/\s+/);
  const groupOrder = new Map<string, number>();
  for (const c of commands) if (!groupOrder.has(c.group)) groupOrder.set(c.group, groupOrder.size);

  const scored: { command: T; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = normalize(command.label);
    const haystack = `${label} ${normalize(command.keywords ?? "")}`;
    if (!words.every((w) => haystack.includes(w))) return;
    const score = label.startsWith(q) ? 0 : label.split(/\s+/).some((w) => w.startsWith(words[0]!)) ? 1 : 2;
    scored.push({ command, score, index });
  });
  scored.sort(
    (a, b) =>
      groupOrder.get(a.command.group)! - groupOrder.get(b.command.group)! ||
      a.score - b.score ||
      a.index - b.index,
  );
  return scored.map((s) => s.command);
}
