import { describe, expect, it } from "vitest";
import { LANDING_TALLY } from "@/lib/landing";

describe("results sentence", () => {
  it("states the results table's figures, green only for the perfect ones", () => {
    expect(LANDING_TALLY.map((c) => `${c.figure} ${c.rest}`)).toEqual([
      "133 of 133 citations pointed at a real passage",
      "30 of 30 unanswerable questions were declined",
      "94% of 150 tickets were labelled correctly",
      "2 of 110 answerable questions were wrongly declined",
    ]);
    expect(LANDING_TALLY.map((c) => c.perfect)).toEqual([true, true, false, false]);
  });
});
