import { describe, expect, it } from "vitest";
import {
  loadDemoLabelFile,
  loadTriageSet,
  loadTriageTicketFile,
  RUBRIC_RULES,
} from "../../scripts/lib/triage-set";
import { DEMO_TICKETS } from "@/server/modules/tickets/demo/tickets";
import { portalTicketInput } from "@/server/modules/tickets/schemas";
import { TICKET_PRIORITIES } from "@/server/modules/tickets/types";
import { DEFAULT_CATEGORIES } from "@/server/platform/auth/workspace-settings";

/**
 * The M6 triage evaluation set (docs/plans/m6-evaluation.md D1): 150 tickets labelled by the
 * rubric in docs/eval/triage-rubric.md. The loader validates each file's shape; these tests
 * check what a schema can't: coverage, balance, and agreement with the demo seed.
 */
describe("triage evaluation set (M6 D1)", () => {
  const set = loadTriageSet();

  it("has 150 tickets with unique keys and unique subjects", () => {
    expect(set).toHaveLength(150);
    expect(new Set(set.map((t) => t.key)).size).toBe(150);
    expect(new Set(set.map((t) => t.subject.trim().toLowerCase())).size).toBe(150);
    expect(new Set(set.map((t) => t.message.trim())).size).toBe(150);
  });

  it("numbers the M6 tickets tri-001 onwards with no gaps", () => {
    const keys = loadTriageTicketFile().tickets.map((t) => t.key);
    expect(keys).toEqual(keys.map((_, i) => `tri-${String(i + 1).padStart(3, "0")}`));
  });

  it.each(set.map((t) => [t.key, t] as const))("%s is valid portal input", (_, t) => {
    const parsed = portalTicketInput.safeParse({
      name: "Eval Customer",
      email: "eval@example.test",
      subject: t.subject,
      message: t.message,
    });
    expect(parsed.success).toBe(true);
  });

  it("names a rubric rule that sets each ticket's priority", () => {
    for (const t of set) expect(RUBRIC_RULES[t.rule].priority, t.key).toBe(t.expected.priority);
  });

  it("labels every feature request low (rule L1), whatever its tone", () => {
    for (const t of set.filter((x) => x.expected.category === "feature-request")) {
      expect([t.key, t.rule]).toEqual([t.key, "L1"]);
    }
  });

  it("never lets urgency words alone make a ticket urgent (M1)", () => {
    const claims = set.filter((t) => t.tags.includes("claims-urgent"));
    expect(claims.length).toBeGreaterThan(0);
    for (const t of claims) expect(t.expected.priority, t.key).not.toBe("urgent");
  });

  it("explains every ticket tagged ambiguous", () => {
    for (const t of set.filter((x) => x.tags.includes("ambiguous"))) expect(t.note, t.key).toBeDefined();
  });

  it("tags non-English tickets consistently with their language label", () => {
    for (const t of set) {
      expect(t.tags.includes("non-english"), t.key).toBe(t.expected.language !== "en");
      if (t.tags.includes("roman-urdu")) expect(t.expected.language, t.key).toBe("ur");
      if (t.tags.includes("mixed-language")) expect(t.expected.language, t.key).toBe("en");
    }
  });

  it("is balanced enough to measure every label (at least 20 per category and priority)", () => {
    const count = (f: (t: (typeof set)[number]) => string, v: string) => set.filter((t) => f(t) === v).length;
    for (const c of DEFAULT_CATEGORIES)
      expect(
        count((t) => t.expected.category, c),
        c,
      ).toBeGreaterThanOrEqual(20);
    for (const p of TICKET_PRIORITIES)
      expect(
        count((t) => t.expected.priority, p),
        p,
      ).toBeGreaterThanOrEqual(20);
    for (const s of ["negative", "neutral", "positive"]) {
      expect(
        count((t) => t.expected.sentiment, s),
        s,
      ).toBeGreaterThanOrEqual(10);
    }
    expect(set.filter((t) => t.expected.language !== "en").length).toBeGreaterThanOrEqual(20);
  });
});

describe("demo ticket labels (eval/triage/demo-labels.json)", () => {
  const file = loadDemoLabelFile();
  const byKey = new Map(DEMO_TICKETS.map((t) => [t.key, t]));

  it("labels exactly the 25 demo tickets, in order", () => {
    expect(file.labels.map((l) => l.key)).toEqual(DEMO_TICKETS.map((t) => t.key));
  });

  it("agrees with the seed's labels, except for changes still waiting for review", () => {
    for (const l of file.labels) {
      const seed = byKey.get(l.key)!.expected;
      const same = seed.category === l.expected.category && seed.priority === l.expected.priority;
      // A proposed change must actually change something; everything else must match the seed.
      expect([l.key, same], l.change ?? "no change proposed").toEqual([l.key, l.change === undefined]);
    }
  });

  it("proposes rewording only where the text needs it", () => {
    for (const l of file.labels.filter((x) => x.proposedMessage)) {
      expect(l.proposedMessage, l.key).not.toBe(byKey.get(l.key)!.message);
    }
  });
});
