import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINISH_MS,
  finishNavigation,
  getNavigationState,
  getNavigationTarget,
  getServerNavigationState,
  getServerNavigationTarget,
  GIVE_UP_MS,
  isTrackedNavigation,
  resetNavigationProgressForTests,
  SHOW_AFTER_MS,
  startNavigation,
  subscribeNavigation,
  trackedLinkHref,
} from "@/lib/navigation-progress";

const here = new URL("https://app.example/app/tickets?status=open");
const plainClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, extra: { target?: string; attrs?: string[] } = {}) => ({
  href: new URL(href, here).href,
  target: extra.target ?? "",
  hasAttribute: (name: string) => (extra.attrs ?? []).includes(name),
});

describe("isTrackedNavigation", () => {
  it("tracks a different path or a different query on the same site", () => {
    expect(isTrackedNavigation(new URL("/app/tickets/24", here), here)).toBe(true);
    expect(isTrackedNavigation(new URL("/app/tickets?status=closed", here), here)).toBe(true);
  });
  it("ignores the same page, a hash-only change, other sites and non-web links", () => {
    expect(isTrackedNavigation(new URL("/app/tickets?status=open", here), here)).toBe(false);
    expect(isTrackedNavigation(new URL("/app/tickets?status=open#row-3", here), here)).toBe(false);
    expect(isTrackedNavigation(new URL("https://github.com/x"), here)).toBe(false);
    expect(isTrackedNavigation(new URL("mailto:help@example.com"), here)).toBe(false);
  });
});

describe("trackedLinkHref", () => {
  it("returns the destination for a plain click on an in-app link", () => {
    expect(trackedLinkHref(plainClick, link("/app/knowledge"), here)).toBe(
      "https://app.example/app/knowledge",
    );
  });
  it("skips clicks the browser opens elsewhere: modifier keys, middle button, new tab", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(trackedLinkHref({ ...plainClick, [key]: true }, link("/app/knowledge"), here)).toBeNull();
    }
    expect(trackedLinkHref({ ...plainClick, button: 1 }, link("/app/knowledge"), here)).toBeNull();
    expect(trackedLinkHref(plainClick, link("/app/knowledge", { target: "_blank" }), here)).toBeNull();
    expect(trackedLinkHref(plainClick, link("/app/knowledge", { target: "_self" }), here)).not.toBeNull();
  });
  it("skips downloads, API routes and opted-out links", () => {
    expect(trackedLinkHref(plainClick, link("/report", { attrs: ["download"] }), here)).toBeNull();
    expect(trackedLinkHref(plainClick, link("/api/export.csv"), here)).toBeNull();
    expect(trackedLinkHref(plainClick, link("/app/audit", { attrs: ["data-no-progress"] }), here)).toBeNull();
  });
});

describe("navigation progress store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { href: here.href } });
    resetNavigationProgressForTests();
  });
  afterEach(() => {
    resetNavigationProgressForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is idle on the server and before anything happens", () => {
    expect(getServerNavigationState()).toBe("idle");
    expect(getNavigationState()).toBe("idle");
  });

  it("knows where a page change is going, and forgets it when it ends", () => {
    expect(getServerNavigationTarget()).toBe("");
    expect(getNavigationTarget()).toBe("");
    startNavigation("https://app.example/app/tickets/24?view=open#top");
    expect(getNavigationTarget()).toBe("/app/tickets/24?view=open");
    finishNavigation();
    expect(getNavigationTarget()).toBe("");
  });

  it("follows a second click to another page while the first is still loading", () => {
    const seen: string[] = [];
    startNavigation("/app/tickets/24");
    subscribeNavigation(() => seen.push(getNavigationTarget()));
    startNavigation("/app/knowledge");
    expect(getNavigationState()).toBe("loading");
    expect(getNavigationTarget()).toBe("/app/knowledge");
    expect(seen).toEqual(["/app/knowledge"]);
  });

  it("gives up after a while and forgets the target", () => {
    startNavigation("/app/tickets/24");
    vi.advanceTimersByTime(GIVE_UP_MS);
    expect(getNavigationState()).not.toBe("loading");
    expect(getNavigationTarget()).toBe("");
  });

  it("ignores a start for the page already open", () => {
    startNavigation("/app/tickets?status=open");
    expect(getNavigationState()).toBe("idle");
  });

  it("a fast page change ends silently, without the finish animation", () => {
    startNavigation("/app/tickets/24");
    expect(getNavigationState()).toBe("loading");
    vi.advanceTimersByTime(SHOW_AFTER_MS - 20);
    finishNavigation();
    expect(getNavigationState()).toBe("idle");
  });

  it("a slow page change fills and fades, then returns to idle", () => {
    const seen: string[] = [];
    subscribeNavigation(() => seen.push(getNavigationState()));
    startNavigation("/app/tickets/24");
    vi.advanceTimersByTime(800);
    finishNavigation();
    expect(getNavigationState()).toBe("done");
    vi.advanceTimersByTime(FINISH_MS);
    expect(seen).toEqual(["loading", "done", "idle"]);
  });

  it("gives up after 15 s if the URL never changes, so the bar can't get stuck", () => {
    startNavigation("/app/tickets/24");
    vi.advanceTimersByTime(GIVE_UP_MS);
    expect(getNavigationState()).toBe("done");
    vi.advanceTimersByTime(FINISH_MS);
    expect(getNavigationState()).toBe("idle");
  });

  it("a second tap while loading keeps one bar running from the first tap", () => {
    startNavigation("/app/tickets/24");
    vi.advanceTimersByTime(100);
    startNavigation("/app/tickets/23");
    vi.advanceTimersByTime(100);
    finishNavigation();
    expect(getNavigationState()).toBe("done"); // 200 ms since the first tap: visible, so it finishes.
  });

  it("finishing when nothing is loading changes nothing (first page render)", () => {
    const listener = vi.fn();
    subscribeNavigation(listener);
    finishNavigation();
    expect(listener).not.toHaveBeenCalled();
  });
});
