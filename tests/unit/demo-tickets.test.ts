import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/server/platform/auth/workspace-settings";
import { DEMO_TICKETS } from "@/server/modules/tickets/demo/tickets";
import { LIMITS } from "@/server/modules/tickets/limits";
import { portalTicketInput } from "@/server/modules/tickets/schemas";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/modules/tickets/types";

/**
 * The demo tickets are also the labelled evaluation set for AI triage (M5/M6), so they
 * must be valid input, internally consistent, and cover every label.
 */
describe("demo tickets (D10 synthetic data)", () => {
  const each = it.each(DEMO_TICKETS.map((t) => [t.key, t] as const));

  it("has 25 tickets with stable, unique keys and unique subjects", () => {
    expect(DEMO_TICKETS).toHaveLength(25);
    expect(new Set(DEMO_TICKETS.map((t) => t.key)).size).toBe(25);
    expect(DEMO_TICKETS.every((t) => /^nim-\d{2}$/.test(t.key))).toBe(true);
    expect(new Set(DEMO_TICKETS.map((t) => t.subject)).size).toBe(25);
  });

  each("%s is valid portal input with undeliverable addresses", (_, t) => {
    const parsed = portalTicketInput.safeParse({
      name: t.customer.name,
      email: t.customer.email,
      subject: t.subject,
      message: t.message,
    });
    expect(parsed.success).toBe(true);
    expect(t.customer.email).toMatch(/@example\.test$/);
    for (const m of t.thread) expect(m.body.trim().length).toBeGreaterThan(0);
    for (const m of t.thread) expect(m.body.length).toBeLessThanOrEqual(LIMITS.message);
  });

  each("%s has labels from the workspace's categories", (_, t) => {
    expect(DEFAULT_CATEGORIES).toContain(t.expected.category);
    if (t.category !== null) expect(t.category).toBe(t.expected.category);
  });

  each("%s has a thread that fits its age, in order", (_, t) => {
    let previous = 0;
    for (const m of t.thread) {
      expect(m.afterHours).toBeGreaterThan(0);
      expect(m.afterHours).toBeGreaterThanOrEqual(previous);
      expect(m.afterHours).toBeLessThan(t.ageHours);
      previous = m.afterHours;
    }
    // Customers never write internal notes.
    expect(t.thread.filter((m) => m.internal && m.from === "customer")).toEqual([]);
  });

  each("%s has a status that matches its conversation", (_, t) => {
    const publicMessages = t.thread.filter((m) => !m.internal);
    const staffReplied = publicMessages.some((m) => m.from !== "customer");
    const lastPublic = publicMessages.at(-1);
    if (t.status === "pending") expect(lastPublic && lastPublic.from !== "customer").toBe(true);
    if (t.status === "open" && staffReplied) expect(lastPublic!.from).toBe("customer");
    if (t.status === "resolved" || t.status === "closed") expect(staffReplied).toBe(true);
  });

  it("untriaged tickets are new: open, unassigned, no staff messages", () => {
    const untriaged = DEMO_TICKETS.filter((t) => t.category === null);
    expect(untriaged.length).toBeGreaterThanOrEqual(5);
    for (const t of untriaged) {
      expect(t.status).toBe("open");
      expect(t.assignee).toBeNull();
      expect(t.thread.filter((m) => m.from !== "customer")).toEqual([]);
    }
  });

  it("covers every status, priority label and category label", () => {
    expect(new Set(DEMO_TICKETS.map((t) => t.status))).toEqual(new Set(TICKET_STATUSES));
    expect(new Set(DEMO_TICKETS.map((t) => t.expected.priority))).toEqual(new Set(TICKET_PRIORITIES));
    expect(new Set(DEMO_TICKETS.map((t) => t.expected.category))).toEqual(new Set(DEFAULT_CATEGORIES));
  });

  it("includes internal notes and a prompt-injection case for the AI safety evaluation", () => {
    expect(DEMO_TICKETS.filter((t) => t.thread.some((m) => m.internal)).length).toBeGreaterThanOrEqual(5);
    const injection = DEMO_TICKETS.find((t) => t.note?.includes("LLM01"));
    expect(injection?.message).toMatch(/ignore all previous instructions/i);
    expect(injection?.category).toBeNull(); // the AI will see it in M5
  });
});
