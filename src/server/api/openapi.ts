import { z } from "zod";
import { can, ROLES } from "@/server/platform/auth/permissions";
import { operations, type Operation } from "./operations";
import { apiRegistry } from "./schemas";

/**
 * Builds the OpenAPI 3.1 document from the operation registry. OpenAPI 3.1 uses JSON
 * Schema 2020-12, Zod's default target.
 * - Response schemas live in `apiRegistry`; Zod renders the whole registry with
 *   cross-references pointing at #/components/schemas/<id> (zod.dev/json-schema#registries).
 * - Request schemas are rendered inline as *input* types: what clients send, before our
 *   normalizing transforms.
 */
type JsonSchema = Record<string, unknown>;

const STATUS_TEXT: Record<number, string> = {
  400: "Invalid input (Problem Details with per-field `errors`).",
  401: "Not signed in.",
  403: "Not allowed (role, workspace, or cross-site request).",
  404: "Not found. Also returned for other workspaces' resources.",
  409: "Conflict (stale version, closed request, or invalid status change).",
  413: "Body too large (JSON bodies: 64 KB; file uploads: see the operation).",
  415: "Wrong body type (JSON, or multipart/form-data for uploads).",
  429: "Rate limited. `Retry-After` says when to try again.",
  502: "The AI provider rejected the request or returned an invalid result.",
  503: "The AI provider is unavailable. `Retry-After` says when to try again.",
};

/** Roles that hold an operation's permission, from the same matrix the services enforce. */
export function rolesFor(op: Operation): string[] | undefined {
  if (!op.permission) return undefined;
  return ROLES.filter((role) => can(role, op.permission!));
}

function requestBody(op: Operation) {
  if (op.upload) {
    return {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: [op.upload.field],
            properties: {
              [op.upload.field]: {
                type: "string",
                contentMediaType: "application/octet-stream",
                description: `${op.upload.description} Limit: ${op.upload.maxFileBytes} bytes.`,
              },
            },
          },
        },
      },
    };
  }
  if (op.body) return { required: true, content: { "application/json": { schema: inline(op.body) } } };
  return undefined;
}

const componentRef = (id: string) => `#/components/schemas/${id}`;

function components(): Record<string, JsonSchema> {
  const { schemas } = z.toJSONSchema(apiRegistry, { uri: componentRef }) as {
    schemas: Record<string, JsonSchema>;
  };
  return Object.fromEntries(
    // $id with a fragment is not allowed in JSON Schema 2020-12; components are addressed by path.
    Object.entries(schemas).map(([id, { id: _id, $id: _sid, $schema: _s, ...rest }]) => [id, rest]),
  );
}

const DOCUMENTED_CHECKS = ["minLength", "maxLength", "format", "pattern"] as const;

/**
 * Inline schema for request bodies and parameters. Input mode renders a pipe as its
 * input side only (e.g. a bare string before trimming), which would hide our limits from
 * clients, so the checks of the pipe's output side are copied over: documented lengths
 * apply after trimming.
 */
function inline(schema: z.ZodType): JsonSchema {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, {
    io: "input",
    override: (ctx) => {
      const def = (ctx.zodSchema as unknown as { _zod: { def: { type: string; out?: z.ZodType } } })._zod.def;
      if (def.type !== "pipe" || !def.out) return;
      // Inner pipes end in the transform itself, which carries no checks to copy.
      if ((def.out as unknown as { _zod: { def: { type: string } } })._zod.def.type === "transform") return;
      const out = z.toJSONSchema(def.out, { io: "output" }) as JsonSchema;
      if (out.type !== ctx.jsonSchema.type) return; // e.g. "a,b" string → array: checks don't apply
      for (const key of DOCUMENTED_CHECKS) {
        if (out[key] !== undefined && ctx.jsonSchema[key] === undefined) {
          (ctx.jsonSchema as JsonSchema)[key] = out[key];
        }
      }
    },
  }) as JsonSchema;
  return rest;
}

function responseSchema(schema: z.ZodType): JsonSchema {
  const id = apiRegistry.get(schema)?.id;
  if (!id) throw new Error("Response schemas must be registered in apiRegistry");
  return { $ref: componentRef(id) };
}

function toParameters(schema: z.ZodType | undefined, location: "path" | "query") {
  if (!schema) return [];
  const json = inline(schema) as { properties?: Record<string, JsonSchema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => {
    const { description, ...rest } = s;
    return {
      name,
      in: location,
      required: location === "path" || (json.required ?? []).includes(name),
      ...(typeof description === "string" ? { description } : {}),
      schema: rest,
    };
  });
}

function operation(op: Operation) {
  const parameters = [...toParameters(op.params, "path"), ...toParameters(op.query, "query")];
  const responses: Record<string, unknown> = {
    [op.success.status]: {
      description: op.success.description,
      ...(op.success.schema
        ? {
            content: {
              [op.success.contentType ?? "application/json"]: { schema: responseSchema(op.success.schema) },
            },
          }
        : {}),
    },
  };
  for (const status of op.errors) {
    responses[status] = {
      description: STATUS_TEXT[status] ?? "Error.",
      content: { "application/problem+json": { schema: { $ref: componentRef("Problem") } } },
    };
  }
  const roles = rolesFor(op);
  const description = [op.description, roles ? `Roles: ${roles.join(", ")}.` : undefined]
    .filter(Boolean)
    .join(" ");
  const body = requestBody(op);
  return {
    operationId: op.id,
    summary: op.summary,
    ...(description ? { description } : {}),
    tags: [op.tag],
    security: op.auth === "session" ? [{ session: [] }] : [],
    ...(roles ? { "x-required-roles": roles } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(body ? { requestBody: body } : {}),
    responses,
  };
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of Object.values(operations) as Operation[]) {
    (paths[op.path] ??= {})[op.method.toLowerCase()] = operation(op);
  }
  return {
    openapi: "3.1.1",
    info: {
      title: "SupportPilot API",
      version: "1.0.0",
      description:
        "Multi-tenant support desk. Errors use RFC 9457 Problem Details. Agent endpoints use the " +
        "browser session (same-origin only); the customer portal uses a secret tracking token.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Portal", description: "Public customer endpoints." },
      { name: "Tickets", description: "Workspace members (owner, admin, agent)." },
      {
        name: "Knowledge",
        description: "Knowledge base for AI answers. Everyone can read; admins and owners manage it.",
      },
      {
        name: "Drafts",
        description:
          "AI reply drafts (generated from a ticket). Sending needs an agent's explicit request; nothing is sent automatically.",
      },
      { name: "Meta" },
    ],
    paths,
    components: {
      schemas: components(),
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Session cookie from /api/auth (prefixed `__Secure-` over HTTPS).",
        },
      },
    },
  };
}
