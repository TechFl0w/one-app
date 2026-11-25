import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Version of the sandbox scripts (built by scripts/build-sandbox.mjs before next): their URLs carry
// it, so browsers can cache them for good and still get each new build.
const sandboxVersion = (() => {
  const h = createHash("sha256");
  for (const f of ["public/sandbox/runtime.js", "public/sandbox/tailwind.js", "public/sandbox/kit.css"]) if (existsSync(f)) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 12);
})();

const nextConfig: NextConfig = {
  // Generated components are type-checked on the server with the TypeScript compiler, which reads
  // its standard library typings from disk at runtime.
  serverExternalPackages: ["typescript", "tailwindcss", "@tailwindcss/oxide"],
  // Chat messages can carry a few design images (resized in the browser; Vercel caps bodies at 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Screen styles are compiled on the server from these stylesheets.
  outputFileTracingIncludes: { "/**": ["./node_modules/typescript/lib/lib.*.d.ts", "./src/sandbox/tailwind-theme.css", "./node_modules/tailwindcss/*.css"] },
  // OAuth discovery for the MCP server (RFC 9728) lives under /.well-known.
  env: { NEXT_PUBLIC_SANDBOX_VERSION: sandboxVersion },
  async headers() {
    return [{ source: "/sandbox/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth-metadata" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth-metadata/:path*" },
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
