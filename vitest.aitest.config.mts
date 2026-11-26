import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** `npm run ai-test`: the AI scenarios against a real business over its MCP link. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.aitest.ts"], testTimeout: 300_000 },
});
