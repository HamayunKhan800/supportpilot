import {
  reviewItemIdParams,
  ReviewVerdictSaved,
  reviewVerdictInput,
} from "@/server/modules/eval-review/schemas";

import type { Operation } from "./operations";

/**
 * Project tooling under /api/internal: validated and protected exactly like /api/v1 (same
 * `apiRoute` wrapper: same-origin check, body cap, Zod), but not part of the public API, so
 * it's left out of the OpenAPI document. Each one is off unless explicitly configured.
 */
export const internalOperations = {
  saveReviewVerdict: {
    id: "saveReviewVerdict",
    method: "POST",
    path: "/api/internal/review/items/{id}/verdict",
    summary: "Record a review verdict (M6 evaluation Review page)",
    description:
      "Only for addresses in EVAL_REVIEWER_EMAILS; everyone else gets 404. Send the content hash you were " +
      "shown: if the item changed since, the verdict is refused with 409.",
    tag: "Internal",
    auth: "session",
    params: reviewItemIdParams,
    body: reviewVerdictInput,
    success: {
      status: 200,
      description: "The saved verdict and the next item to review.",
      schema: ReviewVerdictSaved,
    },
    errors: [400, 401, 403, 404, 409, 413, 415],
  },
} satisfies Record<string, Operation>;
