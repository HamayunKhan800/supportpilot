import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiMessage, apiTicket, apiTriage } from "@/server/api/serializers";
import { getTicketForAgent, updateTicketForAgent } from "@/server/modules/tickets/service";

export const GET = apiRoute(operations.getTicket, async ({ req, params }) => {
  const d = await getTicketForAgent(req.headers, params.id);
  const assignee = d.assignees.find((a) => a.id === d.ticket.assigneeId);
  return {
    ticket: apiTicket(d.ticket, assignee?.name),
    messages: d.messages.map(apiMessage),
    triage: d.triage ? apiTriage(d.triage) : null,
  };
});

export const PATCH = apiRoute(operations.updateTicket, async ({ req, params, body }) => {
  const updated = await updateTicketForAgent(req.headers, params.id, body);
  const d = await getTicketForAgent(req.headers, params.id);
  return apiTicket(updated, d.assignees.find((a) => a.id === updated.assigneeId)?.name);
});
