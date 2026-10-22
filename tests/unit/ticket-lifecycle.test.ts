import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/server/platform/db/schema";
import {
  canAgentPost,
  canAgentTransition,
  canCustomerReply,
  statusAfterCustomerReply,
} from "@/server/modules/tickets/lifecycle";

/** FR-T4: every (from, to) pair, so any change to the state machine shows up here. */
const allowed = new Set([
  "open→pending",
  "open→resolved",
  "open→closed",
  "pending→open",
  "pending→resolved",
  "pending→closed",
  "resolved→open", // reopen
  "resolved→closed",
]);

describe("FR-T4 ticket lifecycle", () => {
  for (const from of TICKET_STATUSES) {
    for (const to of TICKET_STATUSES) {
      const expected = allowed.has(`${from}→${to}`);
      it(`agent ${expected ? "can" : "cannot"} move ${from} → ${to}`, () => {
        expect(canAgentTransition(from, to)).toBe(expected);
      });
    }
  }

  it("treats closed as final", () => {
    expect(TICKET_STATUSES.some((to) => canAgentTransition("closed", to))).toBe(false);
    expect(canCustomerReply("closed")).toBe(false);
    expect(() => statusAfterCustomerReply("closed")).toThrow();
  });

  it("puts a ticket back in the queue when the customer replies", () => {
    for (const s of ["open", "pending", "resolved"] as const) {
      expect(canCustomerReply(s)).toBe(true);
      expect(statusAfterCustomerReply(s)).toBe("open");
    }
  });

  it("allows internal notes on closed tickets but not public replies", () => {
    expect(canAgentPost("closed", true)).toBe(true);
    expect(canAgentPost("closed", false)).toBe(false);
    expect(canAgentPost("open", false)).toBe(true);
  });
});
