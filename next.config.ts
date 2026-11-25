import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
