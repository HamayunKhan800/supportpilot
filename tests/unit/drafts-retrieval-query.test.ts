import { describe, expect, it } from "vitest";

import type { ThreadMessage } from "@/server/modules/ai/untrusted";
import { retrievalQuery } from "@/server/modules/drafts/service";

const customer = (body: string): ThreadMessage => ({ from: "customer", body, internal: false });

describe("retrievalQuery (what the draft pipeline searches with)", () => {
  it("joins the subject and the latest customer message", () => {
    expect(retrievalQuery("Refund", [customer("I was charged twice\nfor my plan.")])).toBe(
      "Refund I was charged twice for my plan.",
    );
  });

  it("searches the message alone when it already contains the subject", () => {
    const q = "How do I turn on two-factor sign-in?";
    expect(retrievalQuery(q, [customer(q)])).toBe(q);
    expect(retrievalQuery("Refund please", [customer("Hi, REFUND  please: I was charged twice.")])).toBe(
      "Hi, REFUND please: I was charged twice.",
    );
  });

  it("uses the newest customer message and never an internal note or an agent reply", () => {
    const thread: ThreadMessage[] = [
      customer("first"),
      { from: "agent", body: "agent reply", internal: false },
      customer("second"),
      { from: "agent", body: "internal note", internal: true },
    ];
    expect(retrievalQuery("Subject", thread)).toBe("Subject second");
  });

  it("falls back to the subject when there is no customer message, and caps the length", () => {
    expect(retrievalQuery("Only a subject", [])).toBe("Only a subject");
    expect(retrievalQuery("S", [customer("x".repeat(900))])).toHaveLength(500);
  });

  it("removes hidden Unicode tag characters (the ones used to smuggle instructions) before searching", () => {
    expect(retrievalQuery("Pass\u{E0041}\u{E0042}word", [customer("reset")])).toBe("Password reset");
  });
});
