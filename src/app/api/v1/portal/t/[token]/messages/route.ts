import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { addCustomerReply, getCustomerTicket } from "@/server/modules/tickets/service";

export const POST = apiRoute(operations.addCustomerReply, async ({ params, body }) => {
  await addCustomerReply(params.token, body);
  return getCustomerTicket(params.token);
});
