import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { KIT_DTS } from "./kitTypes";
import { MAX_COMPONENT_COMPILED, MAX_COMPONENT_SOURCE } from "@/schema/blueprint";

/**
 * Compiles a generated component (server only): type-check against the kit, then TSX → CommonJS.
 * Errors come back as short lines the AI can act on.
 */
export type CompileResult = { ok: true; compiled: string } | { ok: false; errors: string[] };

const ALLOWED_IMPORTS = new Set(["react", "@one/kit"]);
const FILE = "/component.tsx";
const KIT = "/kit.d.ts";

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: [],
};

// Standard library typings are read once per server instance.
const libCache = new Map<string, ts.SourceFile>();
function libFile(name: string): ts.SourceFile | undefined {
  if (libCache.has(name)) return libCache.get(name);
  // Ask TypeScript where its own typings are (bundlers rewrite require.resolve).
  const dir = path.dirname(ts.getDefaultLibFilePath(options));
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return undefined;
  const sf = ts.createSourceFile(name, fs.readFileSync(p, "utf8"), ts.ScriptTarget.ES2022, true);
  libCache.set(name, sf);
  return sf;
}
let kitSource: ts.SourceFile | undefined;

export function checkImports(source: string): string[] {
  const sf = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const errors: string[] = [];
  let hasDefault = false;
  sf.forEachChild((n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !ALLOWED_IMPORTS.has(n.moduleSpecifier.text)) {
      errors.push(`Line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: only "react" and "@one/kit" can be imported (not "${n.moduleSpecifier.text}")`);
    }
    if (ts.isExportAssignment(n)) hasDefault = true;
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) hasDefault = true;
  });
  if (!hasDefault) errors.push("The component must be the default export: export default function MyComponent() { … }");
  return errors;
}

export function compileComponent(source: string): CompileResult {
  if (source.length > MAX_COMPONENT_SOURCE) return { ok: false, errors: [`Too long (${source.length} chars, max ${MAX_COMPONENT_SOURCE}). Split it into smaller components.`] };
  const importErrors = checkImports(source);
  if (importErrors.length) return { ok: false, errors: importErrors };

  kitSource ??= ts.createSourceFile(KIT, KIT_DTS, ts.ScriptTarget.ES2022, true);
  const component = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === FILE ? component : name === KIT ? kitSource : libFile(path.basename(name))),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f === FILE || f === KIT || !!libFile(path.basename(f)),
    readFile: () => undefined,
    // "react" and "@one/kit" are ambient modules declared in kit.d.ts.
    resolveModuleNames: (names) => names.map(() => undefined),
  };
  const program = ts.createProgram([FILE, KIT], options, host);
  const diagnostics = [...program.getSyntacticDiagnostics(component), ...program.getSemanticDiagnostics(component)];
  if (diagnostics.length) {
    return {
      ok: false,
      errors: diagnostics.slice(0, 12).map((d) => {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        return `${pos ? `Line ${pos.line + 1}: ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
      }),
    };
  }

  const out = ts.transpileModule(source, { compilerOptions: { ...options, noEmit: false, sourceMap: false, removeComments: true }, fileName: FILE });
  const compiled = out.outputText;
  if (compiled.length > MAX_COMPONENT_COMPILED) return { ok: false, errors: [`Compiled code is too big (${compiled.length} chars). Split it into smaller components.`] };
  return { ok: true, compiled };
}
