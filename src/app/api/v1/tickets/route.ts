import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiTicket } from "@/server/api/serializers";
import { listTicketsForAgent } from "@/server/modules/tickets/service";

export const GET = apiRoute(operations.listTickets, async ({ req }) => {
  // apiRoute has already validated the query (bad values get a 400 with field errors). The
  // service parses again because the inbox page calls it directly, so it gets the raw strings:
  // the parsed `status` is already an array, which a second parse rejects (finding #84).
  const rawQuery = Object.fromEntries(new URL(req.url).searchParams);
  const page = await listTicketsForAgent(req.headers, rawQuery);
  return {
    items: page.items.map((t) => ({ ...apiTicket(t, t.assigneeName), needsReview: t.needsReview })),
    nextCursor: page.nextCursor,
  };
});
