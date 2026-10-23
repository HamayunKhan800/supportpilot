import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { rateDraft } from "@/server/modules/drafts/actions";

export const POST = apiRoute(operations.rateDraft, async ({ req, params, body }) =>
  rateDraft(req.headers, params.id, body),
);
