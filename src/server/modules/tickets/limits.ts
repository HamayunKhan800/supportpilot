/**
 * Field limits shared by server validation and browser forms. Kept free of imports so
 * client components can use it without bundling server code (e.g. the Drizzle schema).
 */
export const LIMITS = { name: 100, email: 254, subject: 200, message: 10_000, query: 200 } as const;

/** Minimum lengths, after trimming. */
export const MIN = { name: 1, subject: 3, message: 10, reply: 1 } as const;

/** Customer-facing status wording (the customer sees no internal workflow terms). */
export const CUSTOMER_STATUS_LABEL = {
  open: "Open",
  pending: "Waiting for your reply",
  resolved: "Resolved",
  closed: "Closed",
} as const;
