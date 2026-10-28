import { describe, expect, it } from "vitest";
import { draftFunnel } from "@/lib/draft-funnel";

const stats = (byStatus: Record<string, number>, sentUp: number) => ({
  byStatus,
  edited: { n: 0, mean: null, median: null },
  feedback: { up: sentUp + 1, down: 0, sentUp },
});

describe("AI draft funnel", () => {
  it("narrows step by step and says why drafts left", () => {
    const steps = draftFunnel(stats({ sent: 5, discarded: 2, ready: 1, refused: 3, failed: 1 }, 4));
    expect(steps.map((s) => [s.key, s.value])).toEqual([
      ["created", 12],
      ["usable", 8],
      ["sent", 5],
      ["helpful", 4],
    ]);
    expect(steps[0]!.dropped).toBe("3 refused (no answer in the knowledge base, as intended), 1 failed");
    expect(steps[1]!.dropped).toBe("2 discarded, 1 still waiting for an agent");
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.value).toBeLessThanOrEqual(steps[i - 1]!.value);
  });

  it("reads an empty period as zeros, with nothing listed as dropped", () => {
    const steps = draftFunnel(stats({}, 0));
    expect(steps.every((s) => s.value === 0)).toBe(true);
    expect(steps[0]!.dropped).toBe("");
  });

  it("names an unknown status by its key instead of hiding it", () => {
    expect(draftFunnel(stats({ sent: 1, mystery: 2 }, 0))[0]!.dropped).toBe("2 mystery");
  });
});
