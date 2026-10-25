import { operations } from "@/server/api/operations";
import { apiRoute, queryObject } from "@/server/api/route";
import { apiTicket } from "@/server/api/serializers";
import { listTicketsForAgent } from "@/server/modules/tickets/service";

export const GET = apiRoute(operations.listTickets, async ({ req }) => {
  // apiRoute has already validated the query (bad values get a 400 with field errors). The
  // service parses again because the inbox page calls it directly, so it gets the raw strings:
  // the parsed `status` is already an array, which a second parse rejects (finding #84).
  const page = await listTicketsForAgent(req.headers, queryObject(req));
  return {
    items: page.items.map((t) => ({
      ...apiTicket(t, t.assigneeName),
      needsReview: t.needsReview,
      draftReady: t.draftReady,
    })),
    nextCursor: page.nextCursor,
  };
});
