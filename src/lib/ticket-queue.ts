/**
 * The ticket "queue": the list an agent is working through (status tab + filters + page).
 * The list page writes it into each ticket link, so the ticket page can offer
 * previous / next (buttons and j/k) through the same list, in the same order.
 */

/** Status tabs. "Active" (open + pending) is the default working view. */
export const TICKET_TABS = [
  { value: "active", label: "Active", statuses: ["open", "pending"] },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "pending", label: "Pending", statuses: ["pending"] },
  { value: "resolved", label: "Resolved", statuses: ["resolved"] },
  { value: "closed", label: "Closed", statuses: ["closed"] },
  { value: "all", label: "All", statuses: [] },
] as const;

export type TicketTab = (typeof TICKET_TABS)[number];

export const QUEUE_KEYS = [
  "view",
  "q",
  "priority",
  "category",
  "assignee",
  "needsReview",
  "sort",
  "after",
] as const;

export type Queue = Partial<Record<(typeof QUEUE_KEYS)[number], string>>;

type SearchParams = Record<string, string | string[] | undefined>;

/** The queue from a page's search params; unknown keys and empty values are dropped. */
export function readQueue(sp: SearchParams): Queue {
  const out: Queue = {};
  for (const k of QUEUE_KEYS) {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k];
    if (v) out[k] = v;
  }
  return out;
}

export function tabFor(queue: Queue): TicketTab {
  return TICKET_TABS.find((t) => t.value === (queue.view ?? "active")) ?? TICKET_TABS[0];
}

/** The service's list input for a queue (validated by the service, not here). */
export function listInput(queue: Queue) {
  const tab = tabFor(queue);
  return {
    status: tab.statuses.length ? tab.statuses.join(",") : undefined,
    q: queue.q,
    priority: queue.priority,
    category: queue.category,
    assignee: queue.assignee,
    needsReview: queue.needsReview,
    sort: queue.sort,
    after: queue.after,
  };
}

/** True when anything narrows the list beyond its status tab. */
export function isFiltered(queue: Queue): boolean {
  return Boolean(queue.q || queue.priority || queue.category || queue.assignee || queue.needsReview);
}

/** "?view=open&q=refund", or "" for the default queue (so default links stay clean). */
export function queueQuery(queue: Queue, change: Queue = {}): string {
  const merged = { ...queue, ...change };
  const entries = QUEUE_KEYS.flatMap((k) => (merged[k] ? [[k, merged[k]] as [string, string]] : []));
  const qs = new URLSearchParams(entries).toString();
  return qs ? `?${qs}` : "";
}

export function listHref(queue: Queue, change: Queue = {}): string {
  return `/app/tickets${queueQuery(queue, change)}`;
}

export function ticketHref(number: number, queue: Queue): string {
  return `/app/tickets/${number}${queueQuery(queue)}`;
}

export interface Neighbours {
  /** 1-based position of the current ticket in the loaded page of the queue. */
  position: number;
  total: number;
  /** More tickets follow on later pages. */
  more: boolean;
  previous: number | null;
  next: number | null;
}

/** Where `current` sits in the queue's loaded page, or null when it isn't in it. */
export function queueNeighbours(
  numbers: readonly number[],
  current: number,
  more = false,
): Neighbours | null {
  const i = numbers.indexOf(current);
  if (i === -1) return null;
  return {
    position: i + 1,
    total: numbers.length,
    more,
    previous: i > 0 ? numbers[i - 1]! : null,
    next: i < numbers.length - 1 ? numbers[i + 1]! : null,
  };
}
