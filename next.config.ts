import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server for the Docker image (ADR-0008).
  output: "standalone",
  poweredByHeader: false,
  // Cache Components / Partial Prerendering are off: a per-request CSP nonce requires
  // dynamic rendering, and PPR is incompatible with nonce-based CSP (ADR-0011).
  // pg and pino are Node-only; keep them as runtime requires instead of bundling.
  serverExternalPackages: ["pg", "pino"],
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
