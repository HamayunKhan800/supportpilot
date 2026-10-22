import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiTicket } from "@/server/api/serializers";
import { acceptTriageSuggestion, getTicketForAgent } from "@/server/modules/tickets/service";

export const POST = apiRoute(operations.acceptTriageSuggestion, async ({ req, params, body }) => {
  const updated = await acceptTriageSuggestion(req.headers, params.id, body);
  const d = await getTicketForAgent(req.headers, params.id);
  return apiTicket(updated, d.assignees.find((a) => a.id === updated.assigneeId)?.name);
});
