import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/server/platform/db/client";
import {
  organization,
  ticket,
  ticketCounter,
  ticketMessage,
  user,
  type MESSAGE_AUTHOR_TYPES,
  type TICKET_PRIORITIES,
  type TICKET_STATUSES,
} from "@/server/platform/db/schema";

/**
 * Ticket data access. Every function filters by `workspaceId` (tenant isolation, T1),
 * except `findTicketByTokenHash`, where the secret token itself is the credential.
 * Write functions take an executor so services can group writes in one transaction.
 */

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type MessageAuthorType = (typeof MESSAGE_AUTHOR_TYPES)[number];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

export type TicketRow = typeof ticket.$inferSelect;
export type MessageRow = typeof ticketMessage.$inferSelect;

/** Columns safe to return to callers (never the token hash or search vector). */
const ticketColumns = {
  id: ticket.id,
  workspaceId: ticket.workspaceId,
  number: ticket.number,
  subject: ticket.subject,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.category,
  customerName: ticket.customerName,
  customerEmail: ticket.customerEmail,
  assigneeId: ticket.assigneeId,
  version: ticket.version,
  lastActivityAt: ticket.lastActivityAt,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
};
export type Ticket = Omit<TicketRow, "accessTokenHash" | "searchTsv">;

const messageColumns = {
  id: ticketMessage.id,
  ticketId: ticketMessage.ticketId,
  authorType: ticketMessage.authorType,
  authorUserId: ticketMessage.authorUserId,
  authorName: user.name,
  body: ticketMessage.body,
  isInternal: ticketMessage.isInternal,
  createdAt: ticketMessage.createdAt,
};
export type Message = Omit<MessageRow, "workspaceId" | "seq"> & { authorName: string | null };

export function transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().db.transaction(fn);
}

/**
 * Next per-workspace ticket number. The upsert takes a row lock on the workspace's
 * counter, so concurrent transactions are serialized and numbers never repeat (D3).
 */
export async function nextTicketNumber(tx: Executor, workspaceId: string): Promise<number> {
  const [row] = await tx
    .insert(ticketCounter)
    .values({ workspaceId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: ticketCounter.workspaceId,
      set: { lastNumber: sql`${ticketCounter.lastNumber} + 1` },
    })
    .returning({ n: ticketCounter.lastNumber });
  return row!.n;
}

export interface NewTicket {
  subject: string;
  customerName: string;
  customerEmail: string;
  accessTokenHash: string;
  firstMessage: string;
}

export async function insertTicket(tx: Executor, workspaceId: string, input: NewTicket): Promise<Ticket> {
  const number = await nextTicketNumber(tx, workspaceId);
  const [created] = await tx
    .insert(ticket)
    .values({
      workspaceId,
      number,
      subject: input.subject,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      accessTokenHash: input.accessTokenHash,
      searchTsv: sql`to_tsvector('simple', ${[input.subject, input.customerName, input.customerEmail, input.firstMessage].join(" ")})`,
    })
    .returning(ticketColumns);
  await tx.insert(ticketMessage).values({
    workspaceId,
    ticketId: created!.id,
    authorType: "customer",
    body: input.firstMessage,
  });
  return created!;
}

export async function findTicketById(
  workspaceId: string,
  id: string,
  exec: Executor = getDb().db,
): Promise<Ticket | null> {
  const [row] = await exec
    .select(ticketColumns)
    .from(ticket)
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, id)));
  return row ?? null;
}

export async function findTicketByNumber(workspaceId: string, number: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .db.select(ticketColumns)
    .from(ticket)
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.number, number)));
  return row ?? null;
}

/** The token is the credential here, so this is the only lookup without a workspace filter. */
export async function findTicketByTokenHash(accessTokenHash: string): Promise<Ticket | null> {
  const [row] = await getDb()
    .db.select(ticketColumns)
    .from(ticket)
    .where(eq(ticket.accessTokenHash, accessTokenHash));
  return row ?? null;
}

/** Oldest first. `includeInternal: false` is what customers get: internal notes never leave the DB. */
export async function listMessages(
  workspaceId: string,
  ticketId: string,
  opts: { includeInternal: boolean },
): Promise<Message[]> {
  return getDb()
    .db.select(messageColumns)
    .from(ticketMessage)
    .leftJoin(user, eq(ticketMessage.authorUserId, user.id))
    .where(
      and(
        eq(ticketMessage.workspaceId, workspaceId),
        eq(ticketMessage.ticketId, ticketId),
        opts.includeInternal ? undefined : eq(ticketMessage.isInternal, false),
      ),
    )
    .orderBy(asc(ticketMessage.seq));
}

export interface NewMessage {
  authorType: MessageAuthorType;
  authorUserId: string | null;
  body: string;
  isInternal: boolean;
}

/** Adds a message and folds it into the ticket's search document and activity time. */
export async function insertMessage(tx: Executor, workspaceId: string, ticketId: string, input: NewMessage) {
  const [row] = await tx
    .insert(ticketMessage)
    .values({ workspaceId, ticketId, ...input })
    .returning({ id: ticketMessage.id, createdAt: ticketMessage.createdAt });
  await tx
    .update(ticket)
    .set({
      searchTsv: sql`${ticket.searchTsv} || to_tsvector('simple', ${input.body})`,
      lastActivityAt: row!.createdAt,
    })
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, ticketId)));
  return row!;
}

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string | null;
  assigneeId?: string | null;
  lastActivityAt?: Date;
}

/**
 * Applies a patch only if the ticket still has `expectedVersion` (D4). Returns the
 * updated ticket, or null when the ticket is missing or was changed by someone else.
 */
export async function updateTicket(
  tx: Executor,
  workspaceId: string,
  id: string,
  expectedVersion: number,
  patch: TicketPatch,
): Promise<Ticket | null> {
  const [row] = await tx
    .update(ticket)
    .set({ ...patch, version: sql`${ticket.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, id), eq(ticket.version, expectedVersion)))
    .returning(ticketColumns);
  return row ?? null;
}

export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority;
  category?: string;
  /** A user id, or "unassigned". */
  assignee?: string;
  /** websearch syntax ("refund -annual"), or a ticket number like "#12". */
  q?: string;
  /** Only tickets whose AI triage suggestion awaits an agent (M5 D5). */
  needsReview?: boolean;
}

export interface ListTicketsOptions extends TicketFilters {
  sort: "newest" | "oldest";
  limit: number;
  /** Id of the last ticket on the previous page (keyset, see milestones finding #21). */
  afterId?: string;
}

export interface TicketListItem extends Ticket {
  assigneeName: string | null;
  /** The AI's triage suggestion is waiting for an agent. */
  needsReview: boolean;
  /** An AI reply draft is waiting for an agent (same rule as drafts' findOpenDraftId). */
  draftReady: boolean;
}

/** Uses the partial index ticket_triage_open_review_idx. */
const openReview = sql<boolean>`EXISTS (SELECT 1 FROM ticket_triage tt WHERE tt.workspace_id = ${ticket.workspaceId} AND tt.ticket_id = ${ticket.id} AND tt.needs_review AND tt.reviewed_at IS NULL)`;

/**
 * The ticket's newest draft is ready (not sent, discarded, refused or superseded) and the ticket
 * is not closed, matching what the ticket page shows. Uses the index ai_draft_ticket_created_idx.
 */
const draftReady = sql<boolean>`(${ticket.status} <> 'closed' AND COALESCE((SELECT d.status = 'ready' FROM ai_draft d WHERE d.workspace_id = ${ticket.workspaceId} AND d.ticket_id = ${ticket.id} ORDER BY d.created_at DESC, d.id DESC LIMIT 1), false))`;

export async function listTickets(workspaceId: string, opts: ListTicketsOptions) {
  const conditions: (SQL | undefined)[] = [eq(ticket.workspaceId, workspaceId)];
  if (opts.status?.length) conditions.push(inArray(ticket.status, opts.status));
  if (opts.priority) conditions.push(eq(ticket.priority, opts.priority));
  if (opts.category) conditions.push(eq(ticket.category, opts.category));
  if (opts.assignee === "unassigned") conditions.push(isNull(ticket.assigneeId));
  else if (opts.assignee) conditions.push(eq(ticket.assigneeId, opts.assignee));
  if (opts.needsReview) conditions.push(openReview);

  const q = opts.q?.trim();
  if (q) {
    const asNumber = /^#?(\d{1,9})$/.exec(q);
    if (asNumber) {
      conditions.push(eq(ticket.number, Number(asNumber[1])));
    } else {
      conditions.push(sql`${ticket.searchTsv} @@ websearch_to_tsquery('simple', ${q})`);
    }
  }

  const newest = opts.sort === "newest";
  if (opts.afterId) {
    const cursor = sql`(SELECT c.created_at, c.id FROM ticket c WHERE c.id = ${opts.afterId} AND c.workspace_id = ${workspaceId})`;
    conditions.push(
      newest
        ? sql`(${ticket.createdAt}, ${ticket.id}) < ${cursor}`
        : sql`(${ticket.createdAt}, ${ticket.id}) > ${cursor}`,
    );
  }

  const order = newest ? [desc(ticket.createdAt), desc(ticket.id)] : [asc(ticket.createdAt), asc(ticket.id)];
  const rows = await getDb()
    .db.select({ ...ticketColumns, assigneeName: user.name, needsReview: openReview, draftReady })
    .from(ticket)
    .leftJoin(user, eq(ticket.assigneeId, user.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit + 1);

  const items: TicketListItem[] = rows.slice(0, opts.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > opts.limit && last ? last.id : null };
}

export async function countTicketsByStatus(workspaceId: string): Promise<Record<TicketStatus, number>> {
  const rows = await getDb()
    .db.select({ status: ticket.status, n: sql<number>`count(*)::int` })
    .from(ticket)
    .where(eq(ticket.workspaceId, workspaceId))
    .groupBy(ticket.status);
  const counts: Record<TicketStatus, number> = { open: 0, pending: 0, resolved: 0, closed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/**
 * Reads a ticket's status and takes a row lock until the transaction ends, so a
 * concurrent change (e.g. an agent closing while a customer replies) waits instead of
 * interleaving.
 */
export async function lockTicket(tx: Transaction, workspaceId: string, id: string) {
  const [row] = await tx
    .select({ id: ticket.id, status: ticket.status, number: ticket.number })
    .from(ticket)
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, id)))
    .for("update");
  return row ?? null;
}

/** Status change by the system (customer reply), bumping the version so stale agent edits get 409. */
export async function setStatus(tx: Transaction, workspaceId: string, id: string, status: TicketStatus) {
  await tx
    .update(ticket)
    .set({ status, version: sql`${ticket.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, id)));
}

/** Public workspace lookup for the portal. Returns only what the portal may show. */
export async function findWorkspaceBySlug(slug: string) {
  const [row] = await getDb()
    .db.select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug));
  return row ?? null;
}

export async function findWorkspaceName(workspaceId: string): Promise<string | null> {
  const [row] = await getDb()
    .db.select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, workspaceId));
  return row?.name ?? null;
}
