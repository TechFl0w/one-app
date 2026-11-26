// Bundles the sandbox runtime (React + kit) and copies Tailwind's browser build into
// public/sandbox/. Runs before `next build` and `next dev`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile } from "tailwindcss";
import { Scanner } from "@tailwindcss/oxide";
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
// Fallback for screens saved before styles were compiled ahead of time.
copyFileSync(require.resolve("@tailwindcss/browser"), "public/sandbox/tailwind.js");

// The kit's own styles (reset + every class the runtime uses), compiled once.
const theme = readFileSync("src/sandbox/tailwind-theme.css", "utf8");
const compiler = await compile(`@import "tailwindcss/preflight.css" layer(base);\n${theme}`, {
  base: process.cwd(),
  loadStylesheet: async (id, base) => {
    const file = require.resolve(id);
    return { path: file, base, content: readFileSync(file, "utf8") };
  },
});
const candidates = new Scanner({}).getCandidatesWithPositions({ content: ["src/sandbox/runtime.tsx", "src/sandbox/icons.ts"].map((f) => readFileSync(f, "utf8")).join("\n"), extension: "tsx" }).map((c) => c.candidate);
writeFileSync("public/sandbox/kit.css", compiler.build(candidates));
console.log("sandbox runtime built");
