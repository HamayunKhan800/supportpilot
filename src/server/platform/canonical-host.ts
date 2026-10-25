/**
 * One public address (plan M8 step 2). With Cloud Run domain mapping the service's own
 * *.run.app URL stays reachable and can't be switched off, so in production a request that
 * arrives on a *.run.app host other than the app's own (BETTER_AUTH_URL) is sent to the same
 * path on the real domain. Sign-in cookies and OAuth callbacks only work on one origin, and
 * search engines and visitors should see one address.
 *
 * Only *.run.app hosts are redirected: health probes and local runs (localhost, an IP) and a
 * staging service whose own address is its run.app URL are left alone.
 */
export function canonicalRedirect(options: {
  host: string | null;
  pathAndQuery: string;
  canonicalUrl: string | undefined;
  isProduction: boolean;
}): URL | null {
  const { host, pathAndQuery, canonicalUrl, isProduction } = options;
  if (!isProduction || !canonicalUrl || !host) return null;
  let canonical: URL;
  try {
    canonical = new URL(canonicalUrl);
  } catch {
    return null;
  }
  const requested = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (requested === canonical.hostname.toLowerCase()) return null;
  if (!requested.endsWith(".run.app")) return null;
  // Path and query only: the request can't choose where it is sent (no open redirect).
  const target = new URL(canonical.origin);
  const [path, query] = splitPath(pathAndQuery);
  target.pathname = path;
  target.search = query;
  return target;
}

function splitPath(pathAndQuery: string): [string, string] {
  const safe = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const i = safe.indexOf("?");
  return i === -1 ? [safe, ""] : [safe.slice(0, i), safe.slice(i)];
}
