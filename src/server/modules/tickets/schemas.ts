import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/platform/db/schema";
import { stripNul } from "@/server/platform/text";
import { LIMITS, MIN } from "./limits";

/**
 * Input validation for every ticket entry point (REST API and Server Actions share
 * these, NFR-SEC3). Text is normalized before length checks: CRLF → LF, and NUL bytes
 * removed (PostgreSQL rejects \0 in text, which would otherwise surface as a 500).
 */
const clean = (s: string) => stripNul(s.replace(/\r\n?/g, "\n")).trim();
const text = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );
/** Single-line fields also collapse whitespace (no newlines in names or subjects). */
const line = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((s) => clean(s).replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

export { LIMITS, MIN } from "./limits";

export const portalTicketInput = z.object({
  name: line(MIN.name, LIMITS.name, "Name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(LIMITS.email)),
  subject: line(MIN.subject, LIMITS.subject, "Subject"),
  message: text(MIN.message, LIMITS.message, "Message"),
  /** Honeypot: hidden from people, often filled by bots (plan D7). */
  website: z.string().max(500).optional().default(""),
});
export type PortalTicketInput = z.input<typeof portalTicketInput>;

export const customerReplyInput = z.object({ message: text(MIN.reply, LIMITS.message, "Message") });

export const agentMessageInput = z.object({
  body: text(1, LIMITS.message, "Message"),
  internal: z.boolean().default(false),
});

export const ticketPatchInput = z
  .object({
    /** The version the client last saw (optimistic concurrency, plan D4). */
    version: z.int().positive(),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.string().trim().min(1).max(50).nullable().optional(),
    assigneeId: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine((p) => Object.keys(p).some((k) => k !== "version"), { message: "Nothing to update." });
export type TicketPatchInput = z.input<typeof ticketPatchInput>;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));

export const ticketListQuery = z.object({
  status: csv(TICKET_STATUSES)
    .optional()
    .describe(`Comma-separated statuses, e.g. "open,pending". One of: ${TICKET_STATUSES.join(", ")}.`),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  assignee: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('A member\'s user id, "me" or "unassigned".'),
  q: z
    .string()
    .transform((s) => stripNul(s).trim())
    .pipe(z.string().max(LIMITS.query))
    .optional()
    .describe('Full-text search (websearch syntax, e.g. "refund -annual") or a ticket number like "#12".'),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  after: z.uuid().optional().describe("`nextCursor` from the previous page."),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  needsReview: z
    .enum(["true"])
    .optional() // kept as a string: the service parses queries the route already parsed
    .describe('"true": only tickets whose AI triage suggestion is waiting for an agent.'),
});
export type TicketListQuery = z.input<typeof ticketListQuery>;

/** Accepting the AI's triage suggestion: the version the agent was looking at (409 if stale). */
export const triageAcceptInput = z.strictObject({ version: z.int().positive() });

export const ticketId = z.uuid();
export const ticketNumber = z.coerce.number().int().positive().max(2_147_483_647);
