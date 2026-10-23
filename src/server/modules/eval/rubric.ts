/**
 * The priority rules of docs/eval/triage-rubric.md, in the order they are checked (the first
 * that matches wins). The full wording, modifiers and category rules are in that document;
 * this is the short form for the dataset checks and the Review page. Kept free of imports so
 * client components can use it.
 */
export const RUBRIC_RULES = {
  U1: {
    priority: "urgent",
    summary: "Security: someone else may have access, or sensitive files were exposed",
  },
  U2: { priority: "urgent", summary: "Data being lost now, or the trash period ends within 7 days" },
  U3: { priority: "urgent", summary: "Outage for several people (a team, a family)" },
  H1: { priority: "high", summary: "One person blocked from their core work, with no workaround" },
  H2: { priority: "high", summary: "Money wrong: charged twice, the wrong amount, or after cancelling" },
  H3: { priority: "high", summary: "Getting deleted files back while they are still in the trash" },
  H4: { priority: "high", summary: "A request to delete the account or personal data (legal deadline)" },
  N1: { priority: "normal", summary: "A problem with a workaround, or in one part of the product" },
  L2: {
    priority: "low",
    summary: "No time pressure: no rush, plans for later, or a price question before buying",
  },
  N2: { priority: "normal", summary: "Questions and changes: how-to, billing questions, account changes" },
  L1: {
    priority: "low",
    summary: "Ideas and feedback: feature requests, praise, complaints with no request",
  },
} as const;

export type RubricRule = keyof typeof RUBRIC_RULES;
export const RUBRIC_RULE_IDS = Object.keys(RUBRIC_RULES) as RubricRule[];
