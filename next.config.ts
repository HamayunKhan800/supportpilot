import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server for the Docker image (ADR-0008).
  output: "standalone",
  poweredByHeader: false,
  // Cache Components / Partial Prerendering are off: a per-request CSP nonce requires
  // dynamic rendering, and PPR is incompatible with nonce-based CSP (ADR-0011).
  // pg and pino are Node-only; keep them as runtime requires instead of bundling.
  serverExternalPackages: ["pg", "pino"],
  // Pages and API responses get their headers in src/proxy.ts, which doesn't run for build
  // files or the favicon. nosniff covers those too (M7-17, ASVS V3.4.4).
  async headers() {
    return [
      { source: "/_next/static/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      { source: "/favicon.ico", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
