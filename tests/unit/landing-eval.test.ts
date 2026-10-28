import { describe, expect, it } from "vitest";
import { rangeBarClasses } from "@/components/marketing/landing/eval-results";
import { HERO_FOOTNOTES, LANDING_METRICS } from "@/lib/landing";

describe("landing evaluation bars", () => {
  it.each(LANDING_METRICS.map((m) => [m.label, m] as const))("%s has a class for every position", (_, m) => {
    const c = rangeBarClasses(m);
    expect(c.band).toMatch(/^left-\[\d+%\]$/);
    expect(c.width).toMatch(/^w-\[\d+%\]$/);
    expect(c.result).toMatch(/^left-\[\d+%\]$/);
    expect(c.target).toMatch(/^left-\[\d+%\]$/);
  });

  it("places the interval and result where the numbers say", () => {
    const retrieval = LANDING_METRICS.find((m) => m.label.startsWith("Right help article"))!;
    expect(rangeBarClasses(retrieval)).toEqual({
      band: "left-[95%]",
      width: "w-[5%]",
      result: "left-[99%]",
      target: "left-[90%]",
    });
  });
});

describe("hero footnotes", () => {
  it("state the citation result from the results table and link to their evidence", () => {
    const citations = LANDING_METRICS.find((m) => m.label.startsWith("Citations"))!;
    expect(citations).toMatchObject({ result: "100%", n: "133 citations" });
    expect(HERO_FOOTNOTES[0]!.text).toContain(
      "133 of 133 citations pointed at a passage the model was given",
    );
    expect(HERO_FOOTNOTES.map((f) => f.id)).toEqual(["source-1", "source-2"]);
    expect(HERO_FOOTNOTES[0]!.link.href).toMatch(
      /^https:\/\/github\.com\/HamayunKhan800\/supportpilot\/blob\/main\/docs\//,
    );
  });
});
