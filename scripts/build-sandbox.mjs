// Bundles the sandbox runtime (React + kit) and copies Tailwind's browser build into
// public/sandbox/. Runs before `next build` and `next dev`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
mkdirSync("public/sandbox", { recursive: true });
await build({
  entryPoints: ["src/sandbox/runtime.tsx"],
  outfile: "public/sandbox/runtime.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": "./src" },
  legalComments: "none",
  logLevel: "warning",
});
copyFileSync(require.resolve("@tailwindcss/browser"), "public/sandbox/tailwind.js");
console.log("sandbox runtime built");
