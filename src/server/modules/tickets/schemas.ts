import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/platform/db/schema";

/**
 * Input validation for every ticket entry point (REST API and Server Actions share
 * these, NFR-SEC3). Text is normalized before length checks: CRLF → LF, and NUL bytes
 * removed (PostgreSQL rejects \0 in text, which would otherwise surface as a 500).
 */
const clean = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
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

export const LIMITS = { name: 100, email: 254, subject: 200, message: 10_000, query: 200 } as const;

export const portalTicketInput = z.object({
  name: line(1, LIMITS.name, "Name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(LIMITS.email)),
  subject: line(3, LIMITS.subject, "Subject"),
  message: text(10, LIMITS.message, "Message"),
  /** Honeypot: hidden from people, often filled by bots (plan D7). */
  website: z.string().max(500).optional().default(""),
});
export type PortalTicketInput = z.input<typeof portalTicketInput>;

export const customerReplyInput = z.object({ message: text(1, LIMITS.message, "Message") });

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
  status: csv(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  /** A user id, "me" or "unassigned". */
  assignee: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().max(LIMITS.query).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type TicketListQuery = z.input<typeof ticketListQuery>;

export const ticketId = z.uuid();
export const ticketNumber = z.coerce.number().int().positive().max(2_147_483_647);
