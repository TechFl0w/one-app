/**
 * Formula fields: small, safe arithmetic over a record's values, worked out on every read
 * (docs/data-rules.md — values that follow from others are never typed in by hand).
 *
 *   fld_qty * fld_unit_price
 *   fld_total - fld_paid
 *   round(fld_hours * fld_rate, 2)
 *   if(fld_in_stock <= fld_reorder_at, 1, 0)
 *   max(fld_received - fld_used, 0)
 *
 * Numbers, field ids, + - * / %, parentheses, comparisons (< <= > >= == !=, giving 1 or 0) and
 * the functions round, floor, ceil, abs, min, max, if, coalesce. An empty value counts as 0 in
 * arithmetic; division by zero gives no value. Nothing else can run: this is a parser, not eval.
 */

type Node =
  | { k: "num"; v: number }
  | { k: "field"; id: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCTIONS: Record<string, [number, number]> = { round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], min: [1, 20], max: [1, 20], if: [3, 3], coalesce: [1, 20] };

export class FormulaError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(fld_[a-z0-9_]{1,60}|[a-z]+|\d+(?:\.\d+)?|<=|>=|==|!=|[-+*/%(),<>])/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s+$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaError(`Unexpected “${src.slice(i).trim().slice(0, 12)}”`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

export function parseFormula(src: string): Node {
  if (src.length > 2000) throw new FormulaError("Formula is too long");
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const take = (want?: string) => {
    const tok = t[p++];
    if (want && tok !== want) throw new FormulaError(`Expected “${want}”${tok ? ` but found “${tok}”` : ""}`);
    if (tok === undefined) throw new FormulaError("The formula ends too early");
    return tok;
  };
  const cmp = (): Node => {
    let a = add();
    while (["<", "<=", ">", ">=", "==", "!="].includes(peek())) a = { k: "bin", op: take(), a, b: add() };
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (peek() === "+" || peek() === "-") a = { k: "bin", op: take(), a, b: mul() };
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") a = { k: "bin", op: take(), a, b: unary() };
    return a;
  };
  const unary = (): Node => (peek() === "-" ? (take(), { k: "neg", a: unary() }) : peek() === "+" ? (take(), unary()) : atom());
  const atom = (): Node => {
    const tok = take();
    if (tok === "(") {
      const e = cmp();
      take(")");
      return e;
    }
    if (/^\d/.test(tok)) return { k: "num", v: Number(tok) };
    if (tok.startsWith("fld_")) return { k: "field", id: tok };
    if (/^[a-z]+$/.test(tok)) {
      const arity = FUNCTIONS[tok];
      if (!arity) throw new FormulaError(`Unknown function “${tok}”`);
      take("(");
      const args: Node[] = [];
      if (peek() !== ")") {
        args.push(cmp());
        while (peek() === ",") {
          take(",");
          args.push(cmp());
        }
      }
      take(")");
      if (args.length < arity[0] || args.length > arity[1]) throw new FormulaError(`${tok}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} values`);
      return { k: "call", fn: tok, args };
    }
    throw new FormulaError(`Unexpected “${tok}”`);
  };
  if (!t.length) throw new FormulaError("The formula is empty");
  const e = cmp();
  if (p < t.length) throw new FormulaError(`Unexpected “${t[p]}”`);
  return e;
}

/** Field ids a formula reads. */
export function formulaFields(node: Node, out = new Set<string>()): Set<string> {
  if (node.k === "field") out.add(node.id);
  else if (node.k === "neg") formulaFields(node.a, out);
  else if (node.k === "bin") (formulaFields(node.a, out), formulaFields(node.b, out));
  else if (node.k === "call") node.args.forEach((a) => formulaFields(a, out));
  return out;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The formula's value for these record values (null when it can't be worked out). */
export function evaluateFormula(node: Node, data: Record<string, unknown>): number | null {
  const ev = (n: Node): number | null => {
    switch (n.k) {
      case "num":
        return n.v;
      case "field":
        return num(data[n.id]);
      case "neg": {
        const a = ev(n.a);
        return a === null ? null : -a;
      }
      case "bin": {
        const a = ev(n.a) ?? 0;
        const b = ev(n.b) ?? 0;
        switch (n.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? null : a / b;
          case "%": return b === 0 ? null : a % b;
          case "<": return a < b ? 1 : 0;
          case "<=": return a <= b ? 1 : 0;
          case ">": return a > b ? 1 : 0;
          case ">=": return a >= b ? 1 : 0;
          case "==": return a === b ? 1 : 0;
          default: return a !== b ? 1 : 0;
        }
      }
      case "call": {
        const vals = () => n.args.map(ev);
        switch (n.fn) {
          case "round": {
            const [x, d] = vals();
            if (x === null) return null;
            const f = 10 ** Math.max(0, Math.min(6, d ?? 0));
            return Math.round(x * f) / f;
          }
          case "floor": { const x = ev(n.args[0]); return x === null ? null : Math.floor(x); }
          case "ceil": { const x = ev(n.args[0]); return x === null ? null : Math.ceil(x); }
          case "abs": { const x = ev(n.args[0]); return x === null ? null : Math.abs(x); }
          case "min": { const xs = vals().filter((x): x is number => x !== null); return xs.length ? Math.min(...xs) : null; }
          case "max": { const xs = vals().filter((x): x is number => x !== null); return xs.length ? Math.max(...xs) : null; }
          case "if": return ev(n.args[0]) ? ev(n.args[1]) : ev(n.args[2]);
          default: { for (const a of n.args) { const x = ev(a); if (x !== null) return x; } return null; }
        }
      }
    }
  };
  const r = ev(node);
  return r === null || !Number.isFinite(r) ? null : Math.round(r * 1e9) / 1e9;
}

const cache = new Map<string, Node | FormulaError>();
/** Parsed once per expression (formulas run on every read). */
export function compiledFormula(src: string): Node | FormulaError {
  let n = cache.get(src);
  if (!n) {
    try {
      n = parseFormula(src);
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (cache.size > 2000) cache.clear();
    cache.set(src, n);
  }
  return n;
}
