import { z } from "zod";
import { getEnv } from "@/server/platform/env";
import { Errors } from "@/server/platform/errors";
import { withRoute, type RouteContext } from "@/server/platform/http";
import type { Operation } from "./operations";

export const MAX_BODY_BYTES = 64 * 1024;

type Out<T> = T extends z.ZodType ? z.output<T> : undefined;

export interface ApiInput<P, Q, B> {
  req: Request;
  params: Out<P>;
  query: Out<Q>;
  body: Out<B>;
  ctx: RouteContext;
}

/**
 * Turns an operation definition into a Next.js route handler:
 * - CSRF defence in depth (T5): non-GET requests that carry cookies must come from our
 *   own origin (SameSite=Lax cookies and JSON-only bodies are the first layers)
 * - JSON only, bodies capped at 64 KB (read incrementally, never buffered past the cap)
 * - params / query / body validated with the operation's Zod schemas
 *   (malformed path params are 404: they can't identify a resource)
 * - responses are never cached; tracking-token responses also send no Referer (T6)
 */
export function apiRoute<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType>(
  op: Operation<P, Q, B>,
  handler: (input: ApiInput<P, Q, B>) => Promise<unknown>,
) {
  return withRoute<Record<string, string>>(
    op.id,
    async (req, ctx) => {
      if (op.method !== "GET") assertSameOrigin(req);

      const params = op.params ? parseParams(op.params, ctx.params ?? {}) : undefined;
      const query = op.query ? op.query.parse(Object.fromEntries(new URL(req.url).searchParams)) : undefined;
      const body = op.body ? op.body.parse(await readJson(req)) : undefined;

      const result = await handler({ req, params, query, body, ctx } as ApiInput<P, Q, B>);

      const headers = new Headers({ "cache-control": "no-store" });
      if (op.auth === "tracking-token") headers.set("referrer-policy", "no-referrer");
      return Response.json(result, { status: op.success.status, headers });
    },
    { redactPath: op.auth === "tracking-token" },
  );
}

function parseParams(schema: z.ZodType, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

export function assertSameOrigin(req: Request): void {
  if (!req.headers.get("cookie")) return; // no ambient credentials, nothing to forge
  const env = getEnv();
  const allowed = new Set([env.BETTER_AUTH_URL, ...env.AUTH_TRUSTED_ORIGINS].map((u) => new URL(u).origin));
  const origin = req.headers.get("origin");
  if (!origin || !allowed.has(origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw Errors.forbidden();
  }
}

export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw Errors.unsupportedMediaType();
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw Errors.payloadTooLarge(maxBytes);

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Errors.payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw Errors.badRequest("The request body is not valid JSON.");
  }
}
