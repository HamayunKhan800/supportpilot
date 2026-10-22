import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiKbDocument } from "@/server/api/serializers";
import { listKbDocuments, uploadKbDocument } from "@/server/modules/kb/service";

export const GET = apiRoute(operations.listKbDocuments, async ({ req }) => {
  const { items, usage } = await listKbDocuments(req.headers);
  return { items: items.map(apiKbDocument), usage };
});

export const POST = apiRoute(operations.uploadKbDocument, async ({ req, file }) =>
  apiKbDocument(await uploadKbDocument(req.headers, file!)),
);
