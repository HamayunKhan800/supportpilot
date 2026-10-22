import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { apiKbChunk } from "@/server/api/serializers";
import { searchKnowledgeBase } from "@/server/modules/kb/service";

export const POST = apiRoute(operations.searchKb, async ({ req, body }) => {
  const r = await searchKnowledgeBase(req.headers, body);
  return {
    query: r.query,
    model: r.model,
    results: r.results.map((x) => ({
      rank: x.rank,
      chunk: apiKbChunk(x.chunk),
      document: x.document,
      rrfScore: x.rrfScore,
      matchedBy: x.matchedBy,
      vector: x.vector,
      keyword: x.keyword,
    })),
    timingsMs: r.timingsMs,
  };
});
