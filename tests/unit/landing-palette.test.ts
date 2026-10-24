import { describe, expect, it } from "vitest";
import { paletteResults } from "@/components/marketing/landing/team-tools";

const labels = (q: string) => paletteResults(q).map((c) => c.label);

describe("the landing page's command palette", () => {
  it("lists every page and command when empty", () => {
    expect(labels("")).toEqual([
      "Overview",
      "Tickets",
      "Knowledge",
      "Analytics",
      "Evaluation",
      "Members",
      "AI settings",
      "Audit log",
      "Light theme",
      "Dark theme",
      "Use device theme",
      "Keyboard shortcuts",
    ]);
  });

  it("opens a ticket by number, like the app (no free-text search for a number)", () => {
    expect(labels("128")).toEqual(["Open ticket #128"]);
    expect(labels("#42")[0]).toBe("Open ticket #42");
  });

  it("matches search keywords, and offers a ticket search last", () => {
    expect(labels("team")).toEqual(["Members", "Search tickets for “team”"]);
    expect(labels("dark")).toEqual(["Dark theme", "Search tickets for “dark”"]);
    expect(labels("inbox")[0]).toBe("Tickets");
  });

  it("never offers to search articles: the real palette doesn't", () => {
    for (const q of ["refund", "article", "help"]) {
      expect(labels(q).filter((l) => l.startsWith("Search"))).toEqual([`Search tickets for “${q}”`]);
    }
  });
});
