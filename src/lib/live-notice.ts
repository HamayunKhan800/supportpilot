/**
 * What counts as news on a live page (design step 8.4). Plain module: server pages build the
 * notice, and <LiveRefresh /> (a client component) shows it.
 */

/**
 * The newest thing on the page. `order` only grows for newer things (a ticket number, a
 * message time), so it is news only when it is higher than anything seen since the page
 * opened: closing the newest ticket lowers the newest number, and that must not read as new.
 */
export interface LiveNotice {
  order: number;
  title: string;
  description?: string;
  /** Where "Open" goes; omit when the news is already on this page. */
  href?: string;
}

/** The notice for a list of tickets: the highest ticket number is the newest request. */
export function newestTicketNotice(items: { number: number; subject: string }[]): LiveNotice | null {
  const newest = items.reduce<{ number: number; subject: string } | null>(
    (best, t) => (!best || t.number > best.number ? t : best),
    null,
  );
  return newest
    ? {
        order: newest.number,
        title: `New ticket #${newest.number}`,
        description: newest.subject,
        href: `/app/tickets/${newest.number}`,
      }
    : null;
}

/** The notice for a ticket's conversation: the latest customer message. */
export function customerReplyNotice(
  customerName: string,
  messages: { authorType: string; createdAt: Date | string; body: string; isInternal: boolean }[],
): LiveNotice | null {
  const latest = messages.filter((m) => m.authorType === "customer" && !m.isInternal).at(-1);
  if (!latest) return null;
  const text = latest.body.replace(/\s+/g, " ").trim();
  return {
    order: new Date(latest.createdAt).getTime(),
    title: `${customerName} replied`,
    description: text.length > 90 ? `${text.slice(0, 89)}…` : text,
  };
}
