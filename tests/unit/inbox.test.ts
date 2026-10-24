import { describe, expect, it } from "vitest";
import { draftChecks, excerpt } from "@/lib/draft-checks";
import { relativeAge } from "@/lib/relative-time";
import { pageKeyFor, type KeyInput } from "@/lib/shortcuts";
import {
  isFiltered,
  listHref,
  listInput,
  queueNeighbours,
  queueQuery,
  readQueue,
  tabFor,
  ticketHref,
} from "@/lib/ticket-queue";

describe("relativeAge", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;

  it("uses compact units for the last week", () => {
    expect(relativeAge(ago(10_000), now)).toEqual({ short: "now", long: "just now" });
    expect(relativeAge(ago(MIN), now)).toEqual({ short: "1m", long: "1 minute ago" });
    expect(relativeAge(ago(59 * MIN), now)).toEqual({ short: "59m", long: "59 minutes ago" });
    expect(relativeAge(ago(60 * MIN), now)).toEqual({ short: "1h", long: "1 hour ago" });
    expect(relativeAge(ago(23 * 60 * MIN), now).short).toBe("23h");
    expect(relativeAge(ago(24 * 60 * MIN), now)).toEqual({ short: "1d", long: "1 day ago" });
    expect(relativeAge(ago(6 * 24 * 60 * MIN), now).short).toBe("6d");
  });

  it("switches to a UTC date after a week, with the year only for other years", () => {
    expect(relativeAge(new Date("2026-10-03T23:30:00Z"), now)).toEqual({ short: "Oct 3", long: "on Oct 3" });
    expect(relativeAge(new Date("2025-12-31T10:00:00Z"), now).short).toBe("Dec 2025");
  });

  it("never shows a future age when clocks disagree, and accepts epoch numbers", () => {
    expect(relativeAge(new Date(now.getTime() + 5 * MIN), now).short).toBe("now");
    expect(relativeAge(ago(5 * MIN), now.getTime()).short).toBe("5m");
  });
});

describe("ticket queue", () => {
  it("reads only known, non-empty keys (first value wins)", () => {
    expect(readQueue({ view: "open", q: ["refund", "x"], priority: "", evil: "1" })).toEqual({
      view: "open",
      q: "refund",
    });
  });

  it("maps tabs to statuses, defaulting to active", () => {
    expect(tabFor({}).value).toBe("active");
    expect(tabFor({ view: "nope" }).value).toBe("active");
    expect(listInput({}).status).toBe("open,pending");
    expect(listInput({ view: "all" }).status).toBeUndefined();
    expect(listInput({ view: "closed", q: "x", after: "c1" })).toMatchObject({
      status: "closed",
      q: "x",
      after: "c1",
    });
  });

  it("keeps default links clean and carries filters into ticket links", () => {
    expect(queueQuery({})).toBe("");
    expect(ticketHref(12, {})).toBe("/app/tickets/12");
    expect(ticketHref(12, { view: "open", q: "a b" })).toBe("/app/tickets/12?view=open&q=a+b");
    expect(listHref({ q: "x", after: "c" }, { after: undefined })).toBe("/app/tickets?q=x");
    expect(listHref({ assignee: "me" }, { assignee: undefined })).toBe("/app/tickets");
  });

  it("knows when a list is filtered beyond its tab", () => {
    expect(isFiltered({ view: "open", sort: "oldest", after: "c" })).toBe(false);
    expect(isFiltered({ needsReview: "true" })).toBe(true);
  });

  it("finds previous and next in the loaded page", () => {
    expect(queueNeighbours([9, 7, 4], 7)).toEqual({
      position: 2,
      total: 3,
      more: false,
      previous: 9,
      next: 4,
    });
    expect(queueNeighbours([9, 7, 4], 9, true)).toMatchObject({
      position: 1,
      previous: null,
      next: 7,
      more: true,
    });
    expect(queueNeighbours([9, 7, 4], 4)).toMatchObject({ position: 3, next: null });
    expect(queueNeighbours([9, 7, 4], 5)).toBeNull();
    expect(queueNeighbours([], 1)).toBeNull();
  });
});

describe("draftChecks", () => {
  const cited = (n: number, removed = false) => Array.from({ length: n }, () => ({ sourceRemoved: removed }));

  it("lists what passed for a clean draft", () => {
    expect(draftChecks({ warnings: [], citations: cited(2) })).toEqual([
      { id: "sources", ok: true, label: "Cites 2 sources" },
      { id: "citations", ok: true, label: "Every citation matches a source" },
      { id: "links", ok: true, label: "No unfamiliar links" },
    ]);
    expect(draftChecks({ warnings: [], citations: cited(1) })[0]!.label).toBe("Cites 1 source");
  });

  it("turns every server warning into a failed check", () => {
    const checks = draftChecks({
      warnings: ["no_citations", "invalid_citations", "unknown_link", "hidden_characters", "truncated"],
      citations: [],
    });
    expect(checks.every((c) => !c.ok)).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(["sources", "citations", "links", "hidden", "truncated"]);
  });

  it("flags sources that changed, and never invents a score", () => {
    const checks = draftChecks({ warnings: [], citations: cited(1, true) });
    expect(checks.at(-1)).toEqual({ id: "changed", ok: false, label: "A source changed since" });
    expect(checks.some((c) => /\d+\s*%/.test(c.label))).toBe(false);
  });
});

describe("excerpt", () => {
  it("keeps short text and collapses whitespace", () => {
    expect(excerpt("  Refunds\n\ntake 5 days. ")).toBe("Refunds take 5 days.");
  });

  it("drops Markdown syntax but keeps the words", () => {
    expect(excerpt("## Steps\n1. Go to **Settings > Account** and click `Change`.")).toBe(
      "Steps 1. Go to Settings > Account and click Change.",
    );
    expect(excerpt("See [the guide](https://x.test) and *note* 2 * 3 = 6.")).toBe(
      "See the guide and note 2 * 3 = 6.",
    );
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const out = excerpt("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("pageKeyFor", () => {
  const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    typing: false,
    inOverlay: false,
    ...extra,
  });

  it("matches plain letters case-insensitively", () => {
    expect(pageKeyFor(key("j"), ["j", "k"])).toBe("j");
    expect(pageKeyFor(key("K", { shiftKey: false }), ["j", "k"])).toBe("k");
    expect(pageKeyFor(key("x"), ["j", "k"])).toBeNull();
  });

  it("stays out of the way while typing, in overlays and with modifiers", () => {
    expect(pageKeyFor(key("a", { typing: true }), ["a"])).toBeNull();
    expect(pageKeyFor(key("a", { inOverlay: true }), ["a"])).toBeNull();
    expect(pageKeyFor(key("a", { ctrlKey: true }), ["a"])).toBeNull();
    expect(pageKeyFor(key("a", { metaKey: true }), ["a"])).toBeNull();
    expect(pageKeyFor(key("A", { shiftKey: true }), ["a"])).toBeNull();
  });
});
