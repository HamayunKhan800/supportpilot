import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiKbDocument } from "@/server/api/serializers";
import { retryKbDocument } from "@/server/modules/kb/service";

export const POST = apiRoute(operations.retryKbDocument, async ({ req, params }) =>
  apiKbDocument(await retryKbDocument(req.headers, params.id)),
);
