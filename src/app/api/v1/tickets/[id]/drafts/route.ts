import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { startDraft } from "@/server/modules/drafts/service";

/** Streams an AI reply draft as NDJSON (M5 D6). The request's signal cancels the model call. */
export const POST = apiRoute(operations.generateDraft, async ({ req, params }) =>
  startDraft(req.headers, params.id, { signal: req.signal }),
);
