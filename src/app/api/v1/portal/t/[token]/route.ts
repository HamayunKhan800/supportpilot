import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { getCustomerTicket } from "@/server/modules/tickets/service";

export const GET = apiRoute(operations.getCustomerTicket, async ({ params }) =>
  getCustomerTicket(params.token),
);
