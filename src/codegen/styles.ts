import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";
import { Scanner } from "@tailwindcss/oxide";

/**
 * Tailwind CSS for one generated screen, compiled when it's saved (only the classes it uses), so
 * its frame doesn't need Tailwind's in-browser compiler. Classes built at runtime from pieces
 * ("bg-" + color) aren't seen — the same rule as Tailwind everywhere.
 */
const require = createRequire(path.join(process.cwd(), "package.json"));
let compiler: ReturnType<typeof compile> | null = null;

function getCompiler() {
  compiler ??= compile(readFileSync(path.join(process.cwd(), "src/sandbox/tailwind-theme.css"), "utf8"), {
    base: process.cwd(),
    loadStylesheet: async (id, base) => {
      const file = require.resolve(id);
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  return compiler;
}

export const MAX_SCREEN_CSS = 200_000;

/** The CSS for a screen's source, or null if it couldn't be built (the frame then compiles in the browser). */
export async function compileStyles(source: string): Promise<string | null> {
  try {
    const candidates = new Scanner({}).getCandidatesWithPositions({ content: source, extension: "tsx" }).map((c) => c.candidate);
    const css = (await getCompiler()).build(candidates);
    // Safe inside a <style> element in the frame's document.
    const safe = css.replace(/</g, "\\3c ");
    return safe.length <= MAX_SCREEN_CSS ? safe : null;
  } catch (e) {
    console.error("screen styles not compiled:", e);
    return null;
  }
}
