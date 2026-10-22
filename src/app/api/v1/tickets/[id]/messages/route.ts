import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { addAgentMessage } from "@/server/modules/tickets/service";

export const POST = apiRoute(operations.addTicketMessage, async ({ req, params, body }) =>
  addAgentMessage(req.headers, params.id, body),
);
