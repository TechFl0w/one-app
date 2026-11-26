import type { Blueprint } from "@/schema/blueprint";
import { usedIds } from "@/codegen/references";
import { CODE_ON_DEMAND } from "@/sandbox/protocol";

/**
 * The setup as sent to the browser. Generated code's source is only read on the server (the
 * assistant, the code settings page), and each screen's compiled code comes with the page that
 * shows it (or on demand), so every page doesn't carry every screen.
 */
export function forBrowser(bp: Blueprint): Blueprint {
  return {
    ...bp,
    // Only the ids the code uses, so Edit mode can warn before removing something a screen needs.
    components: bp.components?.map(({ css: _css, ...c }) => ({ ...c, compiled: CODE_ON_DEMAND, source: `// source is loaded on the server; uses: ${usedIds(c.source).map((id) => JSON.stringify(id)).join(" ") || "-"}` })),
    functions: bp.functions?.map((f) => ({ ...f, source: "// source is loaded on the server", compiled: "// compiled on the server" })),
  };
}
