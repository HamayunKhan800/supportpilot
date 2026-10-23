import { describe, expect, it } from "vitest";
import { activeHref, groupNav, matchCommands, parseTicketNumber } from "@/lib/navigation";
import { shellActionFor, type KeyInput } from "@/lib/shortcuts";
import { parseSidebarCollapsed, SIDEBAR_COOKIE, sidebarCookie } from "@/lib/sidebar";

const HREFS = ["/app", "/app/tickets", "/app/analytics", "/app/analytics/evaluation", "/app/members"];

describe("activeHref", () => {
  it("prefers an exact match", () => {
    expect(activeHref("/app/analytics", HREFS)).toBe("/app/analytics");
    expect(activeHref("/app", HREFS)).toBe("/app");
  });

  it("gives sub-pages to the longest section that contains them", () => {
    expect(activeHref("/app/tickets/12", HREFS)).toBe("/app/tickets");
    expect(activeHref("/app/analytics/evaluation", HREFS)).toBe("/app/analytics/evaluation");
    expect(activeHref("/app/analytics/evaluation/run-1", HREFS)).toBe("/app/analytics/evaluation");
  });

  it("never lets Overview own other pages, and ignores look-alike prefixes", () => {
    expect(activeHref("/app/account", HREFS)).toBeUndefined();
    expect(activeHref("/app/ticketsx", HREFS)).toBeUndefined();
  });
});

describe("groupNav", () => {
  it("keeps order and groups consecutive items", () => {
    const groups = groupNav([
      { id: 1 },
      { id: 2, group: "work" as const },
      { id: 3, group: "work" as const },
      { id: 4, group: "admin" as const },
    ]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      [undefined, [1]],
      ["work", [2, 3]],
      ["admin", [4]],
    ]);
  });
});

describe("parseTicketNumber", () => {
  it.each([
    ["#12", 12],
    ["12", 12],
    [" # 7 ", 7],
    ["ticket 42", 42],
    ["Ticket #3", 3],
  ])("reads %j as %i", (query, n) => expect(parseTicketNumber(query)).toBe(n));

  it.each(["", "#", "#0", "12a", "refund 12", "-3", "1234567890"])("rejects %j", (query) =>
    expect(parseTicketNumber(query)).toBeUndefined(),
  );
});

describe("matchCommands", () => {
  const commands = [
    { id: "a", label: "Overview", group: "Go to", keywords: "home dashboard" },
    { id: "b", label: "Tickets", group: "Go to", keywords: "inbox" },
    { id: "c", label: "AI settings", group: "Go to" },
    { id: "d", label: "Dark theme", group: "Theme", keywords: "appearance" },
    { id: "e", label: "Keyboard shortcuts", group: "Help" },
    { id: "f", label: "Audit log", group: "Go to", keywords: "history settings" },
  ];
  const ids = (q: string) => matchCommands(q, commands).map((c) => c.id);

  it("returns everything for an empty query", () => {
    expect(ids("  ")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("matches labels and keywords, case-insensitively", () => {
    expect(ids("INBOX")).toEqual(["b"]);
    expect(ids("dark")).toEqual(["d"]);
  });

  it("requires every word", () => {
    expect(ids("dark appearance")).toEqual(["d"]);
    expect(ids("dark inbox")).toEqual([]);
  });

  it("ranks label matches above keyword matches inside a group", () => {
    // "settings" is in the label of AI settings but only in the keywords of Audit log.
    expect(ids("settings")).toEqual(["c", "f"]);
  });

  it("ignores accents", () => {
    expect(matchCommands("resume", [{ id: "x", label: "Résumé", group: "g" }])).toHaveLength(1);
  });
});

describe("shellActionFor", () => {
  const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    typing: false,
    inOverlay: false,
    ...extra,
  });

  it("opens the palette with Ctrl or Cmd + K, even while typing", () => {
    expect(shellActionFor(key("k", { ctrlKey: true }))).toBe("palette");
    expect(shellActionFor(key("K", { metaKey: true, typing: true }))).toBe("palette");
    expect(shellActionFor(key("k", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shellActionFor(key("k"))).toBeNull();
  });

  it("runs single-key shortcuts only outside fields, menus and dialogs (WCAG 2.1.4)", () => {
    expect(shellActionFor(key("?"))).toBe("shortcuts");
    expect(shellActionFor(key("["))).toBe("sidebar");
    expect(shellActionFor(key("?", { typing: true }))).toBeNull();
    expect(shellActionFor(key("[", { inOverlay: true }))).toBeNull();
    expect(shellActionFor(key("?", { ctrlKey: true }))).toBeNull();
    expect(shellActionFor(key("a"))).toBeNull();
  });
});

describe("sidebar preference cookie", () => {
  it("only 'collapsed' collapses; anything else (including tampering) is expanded", () => {
    expect(parseSidebarCollapsed("collapsed")).toBe(true);
    for (const v of [undefined, null, "", "expanded", '"><b>', "COLLAPSED"]) {
      expect(parseSidebarCollapsed(v)).toBe(false);
    }
  });

  it("stores collapsed for a year and deletes the cookie when expanded", () => {
    expect(sidebarCookie(true, true)).toBe(
      `${SIDEBAR_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    expect(sidebarCookie(false, false)).toBe(`${SIDEBAR_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });
});
