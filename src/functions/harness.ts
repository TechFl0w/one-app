/**
 * Files written into the function's VM. The VM has no platform secrets: calls to One App carry no
 * credentials from inside — the VM firewall adds this run's token on the way out — and API keys are
 * placeholders the firewall swaps for the real key on the way to that key's host.
 */
export const RESULT_MARK = "__ONE_RESULT__";
export const SECRET_PREFIX = "one-secret:";

/** @one/server implementation. APP and the input arrive in /app/input.json. */
const KIT_JS = String.raw`
const input = require("./input.json");
const logs = [];
async function call(method, args) {
  const res = await fetch(input.kitUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, args }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ("One App answered " + res.status));
  return body.value;
}
module.exports = {
  records: {
    list: (q) => call("records.list", [q]),
    get: (t, id) => call("records.get", [t, id]),
    create: (t, d) => call("records.create", [t, d]),
    update: (t, id, d) => call("records.update", [t, id, d]),
  },
  secret: (name) => ${JSON.stringify(SECRET_PREFIX)} + String(name),
  log: (...a) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 2000)); },
  __logs: logs,
};
`;

const MAIN_JS = String.raw`
const input = require("./input.json");
const kit = require("./kit.js");
const mod = { exports: {} };
const req = (name) => { if (name === "@one/server") return kit; throw new Error("Can't import " + name); };
new Function("require", "module", "exports", require("fs").readFileSync(__dirname + "/fn.js", "utf8"))(req, mod, mod.exports);
const run = mod.exports.default;
(async () => {
  let out;
  try {
    if (typeof run !== "function") throw new Error("No default export");
    const value = await run(input.ctx);
    out = { ok: true, value: value === undefined ? null : value, logs: kit.__logs };
  } catch (e) {
    out = { ok: false, error: e && e.message ? String(e.message) : String(e), logs: kit.__logs };
  }
  process.stdout.write("\n" + ${JSON.stringify(RESULT_MARK)} + JSON.stringify(out).slice(0, 200000) + "\n");
})();
`;

export interface HarnessInput {
  kitUrl: string;
  ctx: Record<string, unknown>;
}

export function harnessFiles(compiled: string, input: HarnessInput) {
  return [
    { path: "fn.js", content: compiled },
    { path: "kit.js", content: KIT_JS },
    { path: "main.js", content: MAIN_JS },
    { path: "input.json", content: JSON.stringify(input) },
  ];
}

export type FunctionOutcome = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string; logs: string[] };

/** Reads the result line the harness prints; anything else on stdout/stderr is the function's own output. */
export function parseOutcome(stdout: string, stderr: string, exitCode: number | null): FunctionOutcome {
  const line = stdout.split("\n").find((l) => l.startsWith(RESULT_MARK));
  if (line) {
    try {
      return JSON.parse(line.slice(RESULT_MARK.length)) as FunctionOutcome;
    } catch {
      /* fall through */
    }
  }
  const tail = (stderr || stdout).trim().split("\n").slice(-5).join("\n").slice(0, 1000);
  return { ok: false, error: exitCode === null ? "Timed out" : tail || `Exited with code ${exitCode}`, logs: [] };
}
