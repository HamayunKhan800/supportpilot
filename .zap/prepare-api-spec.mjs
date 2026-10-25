#!/usr/bin/env node
// Prepares the OpenAPI file for the ZAP active API scan (see api-scan.yaml).
// ZAP cannot guess real path IDs (it sends `/api/v1/tickets/` with an empty id), so every
// attack would stop at a 308/404. This script asks the throwaway copy for real IDs and writes
// a copy of the spec with those IDs filled into the paths. Node built-ins only.
//
//   ZAP_TARGET=http://localhost:3000 ZAP_COOKIE='better-auth.session_token=…' \
//     node .zap/prepare-api-spec.mjs /path/to/openapi-zap.json
import { writeFileSync } from "node:fs";

const target = process.env.ZAP_TARGET;
const cookie = process.env.ZAP_COOKIE;
const out = process.argv[2];
if (!target || !cookie || !out) {
  console.error("usage: ZAP_TARGET=… ZAP_COOKIE=… node .zap/prepare-api-spec.mjs <out.json>");
  process.exit(2);
}

async function api(method, path, body, { stream = false } = {}) {
  const res = await fetch(new URL(path, target), {
    method,
    headers: { cookie, origin: target, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429)
    throw new Error(`${method} ${path} -> 429: rate limited; use a fresh throwaway database`);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  if (!stream) return res.json();
  // Draft generation streams one JSON event per line; the last one is {"type":"done",…}.
  const lines = (await res.text()).trim().split("\n");
  return JSON.parse(lines.at(-1));
}

const first = (page) => (Array.isArray(page) ? page : (page.data ?? page.items ?? []))[0];

const spec = await api("GET", "/api/v1/openapi.json");
const ticket = first(await api("GET", "/api/v1/tickets?limit=1"));
const doc = first(await api("GET", "/api/v1/kb/documents"));
if (!ticket?.id || !doc?.id) throw new Error("the throwaway copy needs seeded tickets and KB documents");
const done = await api("POST", `/api/v1/tickets/${ticket.id}/drafts`, undefined, { stream: true });
const draftId = done.draft?.id;
if (!draftId) throw new Error("could not create a draft to scan");

const ids = {
  "/api/v1/portal/{slug}/": "nimbus-demo",
  "/api/v1/portal/t/{token}": "zap-not-a-real-token",
  "/api/v1/tickets/{id}": ticket.id,
  "/api/v1/drafts/{id}": draftId,
  "/api/v1/kb/documents/{id}": doc.id,
};

const paths = {};
for (const [path, ops] of Object.entries(spec.paths)) {
  let concrete = path;
  for (const [prefix, value] of Object.entries(ids)) {
    if (path.startsWith(prefix)) concrete = path.replace(/\{[^}]+\}/, value);
  }
  for (const op of Object.values(ops)) {
    if (op && Array.isArray(op.parameters)) op.parameters = op.parameters.filter((p) => p.in !== "path");
  }
  if (/\{[^}]+\}/.test(concrete)) throw new Error(`no real value for ${path}`);
  paths[concrete] = ops;
}
spec.paths = paths;
// Our `license.identifier` is valid OpenAPI 3.1, but ZAP 2.17's parser rejects it; the scan
// copy uses the equivalent URL form instead (the served spec is unchanged).
spec.info.license = { name: "MIT", url: "https://opensource.org/license/mit" };
writeFileSync(out, JSON.stringify(spec, null, 2));
process.stdout.write(`wrote ${Object.keys(paths).length} concrete paths to ${out}\n`);
