import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { discardDraft } from "@/server/modules/drafts/actions";

export const POST = apiRoute(operations.discardDraft, async ({ req, params }) =>
  discardDraft(req.headers, params.id),
);
