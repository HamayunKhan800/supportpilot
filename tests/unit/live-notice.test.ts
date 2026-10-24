import { describe, expect, it } from "vitest";
import { customerReplyNotice, newestTicketNotice } from "@/lib/live-notice";

describe("newestTicketNotice", () => {
  it("picks the highest ticket number, whatever the list order", () => {
    const notice = newestTicketNotice([
      { number: 24, subject: "Sync paused" },
      { number: 26, subject: "Invoice shows the wrong plan" },
      { number: 25, subject: "Password reset" },
    ]);
    expect(notice).toEqual({
      order: 26,
      title: "New ticket #26",
      description: "Invoice shows the wrong plan",
      href: "/app/tickets/26",
    });
  });
  it("has nothing to say about an empty list", () => {
    expect(newestTicketNotice([])).toBeNull();
  });
  it("closing the newest ticket lowers the order, which the component ignores (not news)", () => {
    const before = newestTicketNotice([
      { number: 26, subject: "a" },
      { number: 25, subject: "b" },
    ])!;
    const after = newestTicketNotice([{ number: 25, subject: "b" }])!;
    expect(after.order).toBeLessThan(before.order);
  });
});

describe("customerReplyNotice", () => {
  const at = (iso: string) => new Date(iso);
  it("uses the latest public customer message, not agent replies or notes", () => {
    const notice = customerReplyNotice("Casey Customer", [
      { authorType: "customer", isInternal: false, createdAt: at("2026-10-24T10:00:00Z"), body: "First" },
      {
        authorType: "customer",
        isInternal: false,
        createdAt: at("2026-10-24T11:00:00Z"),
        body: "Still broken",
      },
      { authorType: "agent", isInternal: false, createdAt: at("2026-10-24T11:05:00Z"), body: "Looking" },
      { authorType: "agent", isInternal: true, createdAt: at("2026-10-24T11:06:00Z"), body: "Note" },
    ]);
    expect(notice).toEqual({
      order: Date.parse("2026-10-24T11:00:00Z"),
      title: "Casey Customer replied",
      description: "Still broken",
    });
  });
  it("shortens long messages to one line", () => {
    const body = `Line one\n\n${"word ".repeat(40)}`;
    const notice = customerReplyNotice("Casey", [
      { authorType: "customer", isInternal: false, createdAt: "2026-10-24T10:00:00Z", body },
    ])!;
    expect(notice.description).not.toContain("\n");
    expect(notice.description!.length).toBe(90);
    expect(notice.description!.endsWith("…")).toBe(true);
  });
  it("is null before the customer has written anything public", () => {
    expect(customerReplyNotice("Casey", [])).toBeNull();
  });
});
