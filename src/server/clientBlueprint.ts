import type { Blueprint } from "@/schema/blueprint";
import { usedIds } from "@/codegen/references";

/**
 * The setup as sent to the browser. Generated code's source is only read on the server (the
 * assistant, the code settings page), so the browser gets a placeholder instead — the compiled
 * output stays, since frames and Edit mode need it.
 */
export function forBrowser(bp: Blueprint): Blueprint {
  return {
    ...bp,
    // Only the ids the code uses, so Edit mode can warn before removing something a screen needs.
    components: bp.components?.map((c) => ({ ...c, source: `// source is loaded on the server; uses: ${usedIds(c.source).map((id) => JSON.stringify(id)).join(" ") || "-"}` })),
    functions: bp.functions?.map((f) => ({ ...f, source: "// source is loaded on the server", compiled: "// compiled on the server" })),
  };
}
