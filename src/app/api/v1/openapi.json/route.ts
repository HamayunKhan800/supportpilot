import { buildOpenApiDocument } from "@/server/api/openapi";
import { operations } from "@/server/api/operations";
import { apiRoute } from "@/server/api/route";

export const GET = apiRoute(operations.getOpenApi, async () => buildOpenApiDocument());
