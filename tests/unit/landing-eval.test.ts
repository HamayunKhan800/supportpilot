import { describe, expect, it } from "vitest";
import { rangeBarClasses } from "@/components/marketing/landing/eval-results";
import { LANDING_METRICS } from "@/lib/landing";

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
