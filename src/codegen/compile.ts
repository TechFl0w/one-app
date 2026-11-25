import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { KIT_DTS } from "./kitTypes";
import { SERVER_KIT_DTS } from "./serverKitTypes";
import { MAX_COMPONENT_COMPILED, MAX_COMPONENT_SOURCE } from "@/schema/blueprint";

/**
 * Compiles a generated component (server only): type-check against the kit, then TSX → CommonJS.
 * Errors come back as short lines the AI can act on.
 */
export type CompileResult = { ok: true; compiled: string } | { ok: false; errors: string[] };

type Kind = "component" | "function";
const KINDS: Record<Kind, { imports: Set<string>; dts: string; file: string; hint: string }> = {
  component: { imports: new Set(["react", "@one/kit"]), dts: KIT_DTS, file: "/component.tsx", hint: 'only "react" and "@one/kit" can be imported' },
  function: { imports: new Set(["@one/server"]), dts: SERVER_KIT_DTS, file: "/function.ts", hint: 'only "@one/server" can be imported (fetch is built in)' },
};
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
const kitSources = new Map<Kind, ts.SourceFile>();

export function checkImports(source: string, kind: Kind = "component"): string[] {
  const { file: FILE, imports: ALLOWED_IMPORTS, hint } = KINDS[kind];
  const sf = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, kind === "component" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors: string[] = [];
  let hasDefault = false;
  sf.forEachChild((n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !ALLOWED_IMPORTS.has(n.moduleSpecifier.text)) {
      errors.push(`Line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${hint} (not "${n.moduleSpecifier.text}")`);
    }
    if (ts.isExportAssignment(n)) hasDefault = true;
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) hasDefault = true;
  });
  if (!hasDefault) errors.push(kind === "component" ? "The component must be the default export: export default function MyComponent() { … }" : "The function must be the default export: export default async function run(ctx: RunContext) { … }");
  return errors;
}

export const compileComponent = (source: string) => compileModule(source, "component");
export const compileFunction = (source: string) => compileModule(source, "function");

function compileModule(source: string, kind: Kind): CompileResult {
  const { file: FILE, dts } = KINDS[kind];
  if (source.length > MAX_COMPONENT_SOURCE) return { ok: false, errors: [`Too long (${source.length} chars, max ${MAX_COMPONENT_SOURCE}). Split it up.`] };
  const importErrors = checkImports(source, kind);
  if (importErrors.length) return { ok: false, errors: importErrors };

  if (!kitSources.has(kind)) kitSources.set(kind, ts.createSourceFile(KIT, dts, ts.ScriptTarget.ES2022, true));
  const kitSource = kitSources.get(kind);
  const component = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, kind === "component" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
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
  if (compiled.length > MAX_COMPONENT_COMPILED) return { ok: false, errors: [`Compiled code is too big (${compiled.length} chars). Split it up.`] };
  return { ok: true, compiled };
}
