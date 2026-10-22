import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiKbChunk, apiKbDocument } from "@/server/api/serializers";
import { deleteKbDocument, getKbDocument } from "@/server/modules/kb/service";

export const GET = apiRoute(operations.getKbDocument, async ({ req, params }) => {
  const { document, chunks } = await getKbDocument(req.headers, params.id);
  return { document: apiKbDocument(document), chunks: chunks.map(apiKbChunk) };
});

export const DELETE = apiRoute(operations.deleteKbDocument, async ({ req, params }) => {
  await deleteKbDocument(req.headers, params.id);
});
