import type { Blueprint } from "@/schema/blueprint";

/**
 * The setup as sent to the browser. Generated code's source is only read on the server (the
 * assistant, the code settings page), so the browser gets a placeholder instead — the compiled
 * output stays, since frames and Edit mode need it.
 */
export function forBrowser(bp: Blueprint): Blueprint {
  return {
    ...bp,
    components: bp.components?.map((c) => ({ ...c, source: "// source is loaded on the server" })),
    functions: bp.functions?.map((f) => ({ ...f, source: "// source is loaded on the server", compiled: "// compiled on the server" })),
  };
}
