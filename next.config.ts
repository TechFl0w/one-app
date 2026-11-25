import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generated components are type-checked on the server with the TypeScript compiler, which reads
  // its standard library typings from disk at runtime.
  serverExternalPackages: ["typescript"],
  outputFileTracingIncludes: { "/**": ["./node_modules/typescript/lib/lib.*.d.ts"] },
  // OAuth discovery for the MCP server (RFC 9728) lives under /.well-known.
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
