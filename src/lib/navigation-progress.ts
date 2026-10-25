/**
 * Page-change feedback (design step 8.1, docs/plans/feedback-and-motion.md).
 *
 * Pages render on the server per request, so after a tap nothing changes until the next page
 * arrives. This tiny store drives the top progress bar: link clicks and GET form submits are
 * detected by <NavigationProgress />, and code that navigates with `router.push` calls
 * `startNavigation(href)` first. The bar finishes when the URL (path or query) changes.
 */

type Listener = () => void;

/** idle: nothing shown · loading: a page change is in progress · done: the bar fills and fades. */
export type NavigationState = "idle" | "loading" | "done";

/** Below this the page change feels instant, so the bar never becomes visible (NN/g 0.1 s). */
export const SHOW_AFTER_MS = 120;
/** Length of the fill-and-fade finish (matches `nav-progress-done` in globals.css). */
export const FINISH_MS = 320;
/** Never leave the bar running if a navigation is abandoned without a URL change. */
export const GIVE_UP_MS = 15_000;

let state: NavigationState = "idle";
/** Where the page change in progress is going (path and query), or "" when none. */
let target = "";
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

function set(next: NavigationState) {
  if (state === next) return;
  state = next;
  if (next !== "loading") target = "";
  notify();
}

function schedule(fn: () => void, ms: number) {
  clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

export function subscribeNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNavigationState(): NavigationState {
  return state;
}

/** The destination of the page change in progress ("/app/tickets?view=open"), or "". */
export function getNavigationTarget(): string {
  return target;
}

export function getServerNavigationTarget(): string {
  return "";
}

/** Always idle on the server: nothing is loading during the first render. */
export function getServerNavigationState(): NavigationState {
  return "idle";
}

function begin(to: URL) {
  if (state !== "loading") startedAt = Date.now();
  const next = to.pathname + to.search;
  if (state === "loading" && target !== next) {
    target = next;
    notify();
  }
  target = next;
  set("loading");
  schedule(finishNavigation, GIVE_UP_MS);
}

/**
 * True when going to `target` loads a different page in this app: same origin and a different
 * path or query. A change of only the `#hash` scrolls and loads nothing, so it is not tracked.
 */
export function isTrackedNavigation(target: URL, current: URL): boolean {
  if (target.origin !== current.origin) return false;
  if (!/^https?:$/.test(target.protocol)) return false;
  return target.pathname !== current.pathname || target.search !== current.search;
}

/** Start the bar before a `router.push`/`router.replace` to `href` (ignored if it is this page). */
export function startNavigation(href: string): void {
  if (typeof window === "undefined") return;
  const current = new URL(window.location.href);
  const to = new URL(href, current);
  if (isTrackedNavigation(to, current)) begin(to);
}

/** The new page has landed. Fast changes end silently; slower ones fill and fade the bar. */
export function finishNavigation(): void {
  if (state !== "loading") return;
  if (Date.now() - startedAt < SHOW_AFTER_MS) {
    clearTimeout(timer);
    set("idle");
    return;
  }
  set("done");
  schedule(() => set("idle"), FINISH_MS);
}

/** Test hook: reset module state between unit tests. */
export function resetNavigationProgressForTests(): void {
  clearTimeout(timer);
  state = "idle";
  target = "";
  startedAt = 0;
  listeners.clear();
}

/**
 * The link a click should start the bar for, or null. Skips clicks the browser handles itself:
 * modifier keys or a non-primary button (new tab/window), `target` other than `_self`,
 * `download`, `/api/` routes, and links that opt out with `data-no-progress`.
 */
export function trackedLinkHref(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  anchor: { href: string; target: string; hasAttribute(name: string): boolean },
  current: URL,
): string | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download") || anchor.hasAttribute("data-no-progress")) return null;
  if (!anchor.href) return null;
  const target = new URL(anchor.href, current);
  // API routes are files and downloads (no page change), so the bar would wait for nothing.
  if (target.pathname.startsWith("/api/")) return null;
  return isTrackedNavigation(target, current) ? target.href : null;
}
