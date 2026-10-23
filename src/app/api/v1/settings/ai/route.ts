import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";
import { getAiSettings, updateAiSettings } from "@/server/modules/settings/service";

export const GET = apiRoute(operations.getAiSettings, async ({ req }) => getAiSettings(req.headers));

// The service parses the body again; the schema is idempotent (unit-tested), unlike #79/#84.
export const PATCH = apiRoute(operations.updateAiSettings, async ({ req, body }) =>
  updateAiSettings(req.headers, body),
);
