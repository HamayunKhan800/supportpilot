import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { sendDraft } from "@/server/modules/drafts/actions";

export const POST = apiRoute(operations.sendDraft, async ({ req, params, body }) =>
  sendDraft(req.headers, params.id, body),
);
