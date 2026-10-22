import { describe, expect, it } from "vitest";
import {
  agentMessageInput,
  portalTicketInput,
  ticketListQuery,
  ticketPatchInput,
} from "@/server/modules/tickets/schemas";

const valid = {
  name: "Casey Customer",
  email: "Casey@Example.TEST",
  subject: "Sync stopped",
  message: "My files stopped syncing yesterday.",
};

describe("portal ticket input (NFR-SEC3)", () => {
  it("normalizes valid input", () => {
    const parsed = portalTicketInput.parse({
      ...valid,
      name: "  Casey \n Customer ",
      message: "Line 1\r\nLine 2 ok",
    });
    expect(parsed).toMatchObject({
      name: "Casey Customer",
      email: "casey@example.test",
      message: "Line 1\nLine 2 ok",
    });
    expect(parsed.website).toBe("");
  });

  it("removes NUL bytes, which PostgreSQL text columns reject", () => {
    const parsed = portalTicketInput.parse({ ...valid, message: "Hello\u0000 world, help" });
    expect(parsed.message).toBe("Hello world, help");
  });

  it("enforces lengths after trimming", () => {
    const r = portalTicketInput.safeParse({ ...valid, subject: "  ab  ", message: " ".repeat(50) + "short" });
    expect(r.success).toBe(false);
    const fields = r.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["subject", "message"]));
    expect(portalTicketInput.safeParse({ ...valid, message: "x".repeat(10_001) }).success).toBe(false);
  });

  it("rejects invalid emails and unknown types", () => {
    expect(portalTicketInput.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(portalTicketInput.safeParse({ ...valid, name: 42 }).success).toBe(false);
  });
});

describe("agent inputs", () => {
  it("defaults to a public reply", () => {
    expect(agentMessageInput.parse({ body: "Thanks!" })).toEqual({ body: "Thanks!", internal: false });
    expect(agentMessageInput.safeParse({ body: "   " }).success).toBe(false);
  });

  it("requires a version and at least one change", () => {
    expect(ticketPatchInput.safeParse({ status: "pending" }).success).toBe(false);
    expect(ticketPatchInput.safeParse({ version: 1 }).success).toBe(false);
    expect(ticketPatchInput.safeParse({ version: 1, status: "deleted" }).success).toBe(false);
    expect(ticketPatchInput.parse({ version: 3, assigneeId: null })).toEqual({
      version: 3,
      assigneeId: null,
    });
  });

  it("parses queue query strings", () => {
    expect(ticketListQuery.parse({ status: "open,pending", limit: "10" })).toMatchObject({
      status: ["open", "pending"],
      limit: 10,
      sort: "newest",
    });
    expect(ticketListQuery.safeParse({ status: "open,bogus" }).success).toBe(false);
    expect(ticketListQuery.safeParse({ after: "not-a-uuid" }).success).toBe(false);
    expect(ticketListQuery.safeParse({ limit: "1000" }).success).toBe(false);
    expect(ticketListQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});
