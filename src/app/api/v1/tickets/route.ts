import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiTicket } from "@/server/api/serializers";
import { listTicketsForAgent } from "@/server/modules/tickets/service";

export const GET = apiRoute(operations.listTickets, async ({ req, query }) => {
  const page = await listTicketsForAgent(req.headers, query);
  return { items: page.items.map((t) => apiTicket(t, t.assigneeName)), nextCursor: page.nextCursor };
});
