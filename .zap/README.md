# ZAP scans (M7 step 3)

Two [ZAP](https://www.zaproxy.org/) scans run against a **throwaway copy** of SupportPilot, meaning a fresh database and server that exist only for the scan. They run in CI (`zap` job in `.github/workflows/security.yml`) and can also run locally. **Never point them at a real deployment.** The active scan sends attacks and writes junk data.

| Scan     | Plan            | What it does                                                                                                                                                     |
| -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseline | `baseline.yaml` | Crawls the site as a visitor, then as the demo agent, and checks the traffic passively (headers, cookies, forms, leaks). No attacks.                             |
| api      | `api-scan.yaml` | Imports `/api/v1/openapi.json` with real IDs filled in (`prepare-api-spec.mjs`), then runs ZAP's default active rules against every operation as the demo admin. |

In CI the baseline runs on every push and pull request. The active API scan runs only when started by hand (Actions → Security → Run workflow).

Both plans end with an `exitStatus` job, so the run **fails on any Low or higher alert** that is not in the reviewed list below. CI also fails if the server answered 500 at any point during the scans.

## Run locally

Needs Java 17+, [ZAP 2.17.0](https://github.com/zaproxy/zaproxy/releases/tag/v2.17.0) (or Docker), `curl`, `python3` and `node`.

```bash
createdb supportpilot_zap                                  # throwaway database
DATABASE_URL=…/supportpilot_zap pnpm db:migrate
DATABASE_URL=…/supportpilot_zap DEMO_PASSWORD='…' pnpm db:seed-demo
# start a production build on that database (AI_PROVIDER=mock), then:
ZAP_TARGET=http://localhost:3000 DEMO_PASSWORD='…' ZAP_CMD=/path/to/ZAP_2.17.0/zap.sh .zap/run.sh baseline
ZAP_TARGET=http://localhost:3000 DEMO_PASSWORD='…' ZAP_CMD=/path/to/ZAP_2.17.0/zap.sh .zap/run.sh api
```

Reports go to `./zap-out` (`zap-baseline.*`, `zap-api.*`). Use a fresh database for each active run, because the scan fills the draft rate limit (20 per user per 10 minutes).

Two ZAP 2.17.0 quirks that `run.sh` works around:

- ZAP doesn't expand `${VAR}` inside the replacer job, so `run.sh` expands the whole plan first. It deletes the expanded copy afterwards, because that copy holds the session cookie.
- ZAP's OpenAPI parser rejects our valid 3.1 `license.identifier`, so the scan copy uses the URL form instead.

## Reviewed alerts (false positives, filtered in both plans)

| Rule  | Alert                                     | Why it is a false positive here                                                                                                            |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 10202 | Absence of anti-CSRF tokens (sign-in/up)  | The forms post JSON with `fetch`; Better Auth checks `Origin` and the session cookie is `SameSite=Lax`.                                    |
| 10027 | Suspicious comments                       | It matched `https://…` URLs in minified framework code and our footer link. All 11 reported matches were checked; none was a real comment. |
| 10019 | Content-Type missing (`/api/`, `//` URLs) | Next.js 308 redirects for a trailing or doubled slash, with a tiny plain body.                                                             |
| 10106 | HTTP only site                            | The scan runs plain HTTP on localhost. Production is HTTPS-only with HSTS (checked at M8).                                                 |

Informational alerts (`10109` modern web app, `10104` user-agent fuzzer) are left in the report and don't fail the run.

## Results, 2026-10-25 (local run, ZAP 2.17.0, mock AI, production build)

- **Baseline:** 64 public URLs and 299 signed-in URLs crawled. Real alerts: `nosniff` missing on `/_next/static/*` (**M7-17**), and a form submitted without JavaScript put its data in the URL (**M7-18**).
- **API scan:** about 7,660 requests across all 17 paths, as the admin with the workspace active. The server log shows them reaching real code: 440 × 200, 5 × 201, 1 × 204, 5,683 × 400 (rejected by validation), 959 × 429 (rate limits), 303 × 404, 246 × 409, 24 × 415 (wrong content type). ZAP raised no injection, XSS, path traversal or other Low+ alert. The server log showed **one 500**: a NUL character in a draft-feedback note (**M7-19**, reproduced with curl; the ticket search `q` fails the same way).
- Findings are tracked in [`docs/security/asvs-l2.md`](../docs/security/asvs-l2.md) and fixed in step 5.

## Not covered

- `/api/auth/*` (Better Auth) is crawled by the baseline but not attacked by the active scan; step 4 tests it by hand (rate limits, IP spoofing, open redirect).
- Customer tracking-token routes were scanned with a fake token only (404 path).
- There is no AJAX spider, so pages reached only through client-side navigation may be missed by the baseline crawl.
- The CI job had not run yet when this was written; it first runs on the next push.
