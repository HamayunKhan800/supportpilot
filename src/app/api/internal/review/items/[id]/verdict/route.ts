import { internalOperations } from "@/server/api/internal-operations";
import { apiRoute } from "@/server/api/route";
import { requireReviewer, saveReviewVerdict } from "@/server/modules/eval-review/service";

export const POST = apiRoute(
  internalOperations.saveReviewVerdict,
  async ({ req, params, body }) => saveReviewVerdict(req.headers, params.id, body),
  // Off, or not a reviewer: 404 before the body or origin is even looked at.
  { gate: async (req) => void (await requireReviewer(req.headers)) },
);
