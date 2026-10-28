import { describe, expect, it } from "vitest";
import { missGroups } from "@/server/modules/eval/misses-view";

const row = (suite: "triage" | "retrieval" | "draft" | "injection", itemKey: string, result: unknown) => ({
  suite,
  itemKey,
  result: result as Record<string, unknown>,
});

describe("what the evaluation run got wrong", () => {
  it("reads each test set's misses with the ticket or question from the fixed sets", () => {
    const groups = missGroups([
      row("draft", "u001", {
        id: "u001",
        set: "unanswerable",
        question: "Can I buy extra storage?",
        goldArticle: null,
        status: "ready",
        citedTitles: ["Plans and pricing"],
      }),
      row("triage", "tri-001", {
        key: "tri-001",
        expected: { category: "billing", priority: "urgent" },
        got: { category: "account", priority: "high" },
        status: "succeeded",
      }),
      row("triage", "nim-01", {
        key: "nim-01",
        expected: { category: "billing", priority: "high" },
        got: null,
        status: "failed",
      }),
      row("retrieval", "q001", {
        id: "q001",
        retrieved: ["plans.md", "plans.md", "account-recovery.md", "x.md", "y.md"],
      }),
    ]);
    expect(groups.map((g) => g.suite)).toEqual(["triage", "retrieval", "draft"]); // report order
    const [triage, retrieval, draft] = groups;
    expect(triage!.items[0]).toEqual({
      key: "tri-001",
      what: "Charged 3 times this morning??",
      expected: "billing · urgent",
      got: "account · high",
    });
    expect(triage!.items[1]).toMatchObject({
      what: "Charged twice for my annual plan",
      got: "No answer (failed)",
    });
    expect(retrieval!.items[0]).toEqual({
      key: "q001",
      what: "Do I need a credit card to sign up?",
      expected: "Getting started with Nimbus",
      got: "Top results: plans.md; Recover a locked account; x.md", // each article once, by title
    });
    expect(draft!.items[0]).toMatchObject({
      expected: "Decline: the knowledge base has no answer",
      got: "Answered, citing Plans and pricing",
    });
  });

  it("counts a result it can't read instead of failing, and falls back to the key", () => {
    const [g] = missGroups([
      row("triage", "tri-999", {
        key: "tri-999",
        expected: { category: "bug", priority: "low" },
        got: { category: "bug", priority: "high" },
        status: "succeeded",
      }),
      row("triage", "tri-002", { key: "tri-002", expected: "billing" }),
    ]);
    expect(g!.items).toHaveLength(1);
    expect(g!.items[0]!.what).toBe("tri-999");
    expect(g!.unreadable).toBe(1);
  });

  it("names the expected article by its title, as agents see it", () => {
    const [g] = missGroups([
      row("draft", "q009", {
        id: "q009",
        set: "answerable",
        question: "Why do I have to wait three days?",
        goldArticle: "account-recovery.md",
        status: "refused",
        citedTitles: [],
      }),
    ]);
    expect(g!.items[0]).toMatchObject({
      expected: "Answer citing Recover a locked account",
      got: "Declined to answer",
    });
  });

  it("shows nothing when nothing was missed", () => {
    expect(missGroups([])).toEqual([]);
  });
});
