import { connection } from "next/server";
import { canReadOutbox, OUTBOX_TOKEN_HEADER, readOutbox } from "@/server/platform/email/outbox";
import { getEnv } from "@/server/platform/env";
import { withRoute } from "@/server/platform/http";

/**
 * Development and test only: the emails the in-memory outbox "sent", so browser tests can read
 * a verification code or a reset link. 404 unless EMAIL_PROVIDER=outbox and the request carries
 * EMAIL_OUTBOX_TOKEN, so a public deployment never exposes it.
 */
export const GET = withRoute("dev.email_outbox", async (req: Request) => {
  await connection();
  const headers = { "cache-control": "no-store" };
  if (!canReadOutbox(getEnv(), req.headers.get(OUTBOX_TOKEN_HEADER))) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const to = new URL(req.url).searchParams.get("to") ?? undefined;
  return Response.json({ messages: readOutbox(to) }, { headers });
});
