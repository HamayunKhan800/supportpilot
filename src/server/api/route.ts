import { z } from "zod";
import { getEnv } from "@/server/platform/env";
import { Errors } from "@/server/platform/errors";
import { withRoute, type RouteContext } from "@/server/platform/http";
import type { Operation } from "./operations";

export const MAX_BODY_BYTES = 64 * 1024;

type Out<T> = T extends z.ZodType ? z.output<T> : undefined;

export interface UploadedFile {
  /** As sent by the browser: untrusted, validated by the service. */
  name: string;
  bytes: Buffer;
}

export interface ApiInput<P, Q, B> {
  req: Request;
  params: Out<P>;
  query: Out<Q>;
  body: Out<B>;
  /** Set for upload operations. */
  file: UploadedFile | undefined;
  ctx: RouteContext;
}

/** Room for multipart boundaries and part headers around the file itself. */
export const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

/**
 * Turns an operation definition into a Next.js route handler:
 * - CSRF defence in depth (T5): non-GET requests that carry cookies must come from our
 *   own origin (SameSite=Lax cookies and JSON-only bodies are the first layers)
 * - JSON bodies capped at 64 KB; file uploads (multipart) capped at the operation's file
 *   limit. Bodies are read incrementally and never buffered past the cap
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
      const file = op.upload
        ? await readUploadedFile(req, op.upload.field, op.upload.maxFileBytes)
        : undefined;

      const result = await handler({ req, params, query, body, file, ctx } as ApiInput<P, Q, B>);

      const headers = new Headers({ "cache-control": "no-store" });
      // A streaming operation hands back its own body (e.g. NDJSON drafts, D6).
      if (result instanceof ReadableStream) {
        headers.set("content-type", `${op.success.contentType ?? "application/octet-stream"}; charset=utf-8`);
        // Stops proxies and compression middleware from buffering the stream (AI SDK guidance).
        headers.set("content-encoding", "none");
        headers.set("x-accel-buffering", "no");
        return new Response(result as ReadableStream<Uint8Array>, { status: op.success.status, headers });
      }
      if (op.auth === "tracking-token") headers.set("referrer-policy", "no-referrer");
      if (op.success.status === 204) return new Response(null, { status: 204, headers });
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

/** Reads the whole body, refusing (and cancelling the stream) as soon as it passes `maxBytes`. */
async function readBodyCapped(req: Request, maxBytes: number, tooLarge: () => Error): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw tooLarge();
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
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

/**
 * Reads one file from a multipart/form-data body. The size cap applies while the body
 * streams in (file limit + a small envelope), and again to the file itself.
 */
export async function readUploadedFile(
  req: Request,
  field: string,
  maxFileBytes: number,
): Promise<UploadedFile> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) {
    throw Errors.unsupportedMediaType("Send the file as multipart/form-data.");
  }
  const raw = await readBodyCapped(req, maxFileBytes + MULTIPART_ENVELOPE_BYTES, () =>
    Errors.fileTooLarge(maxFileBytes),
  );
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(raw), { headers: { "content-type": type } }).formData();
  } catch {
    throw Errors.badRequest("The multipart body could not be read.");
  }
  const value = form.get(field);
  if (value === null || typeof value === "string") {
    throw Errors.badRequest("Attach a file.", { [field]: [`Attach a file in the \`${field}\` field.`] });
  }
  if (value.size > maxFileBytes) throw Errors.fileTooLarge(maxFileBytes);
  return { name: value.name, bytes: Buffer.from(await value.arrayBuffer()) };
}

export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw Errors.unsupportedMediaType();
  const text = (await readBodyCapped(req, maxBytes, () => Errors.payloadTooLarge(maxBytes))).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw Errors.badRequest("The request body is not valid JSON.");
  }
}
