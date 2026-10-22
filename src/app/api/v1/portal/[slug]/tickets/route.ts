import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { createPortalTicket } from "@/server/modules/tickets/service";
import { getEnv } from "@/server/platform/env";
import { clientIp } from "@/server/platform/rate-limit";

export const POST = apiRoute(operations.createPortalTicket, async ({ req, params, body }) => {
  const env = getEnv();
  const { token } = await createPortalTicket(
    params.slug,
    body,
    clientIp(req.headers, env.TRUST_PROXY_HEADERS),
  );
  return { trackingUrl: new URL(`/t/${token}`, env.BETTER_AUTH_URL).toString() };
});
