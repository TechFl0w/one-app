import type { NetworkPolicy } from "@vercel/sandbox";
import { harnessFiles, parseOutcome, SECRET_PREFIX, type FunctionOutcome, type HarnessInput } from "./harness";

/** An API key the firewall injects: requests to `host` whose header carries the placeholder get the real value. */
export interface SecretRule {
  name: string;
  host: string;
  header: string;
  prefix: string;
  value: string;
}

export interface RunRequest {
  compiled: string;
  input: HarnessInput;
  /** One App's host (gets the run token added) and the function's allowed hosts. */
  appHost: string;
  runToken: string;
  hosts: string[];
  secrets: SecretRule[];
  timeoutMs: number;
}

export interface FunctionRunner {
  name: string;
  run(req: RunRequest): Promise<FunctionOutcome>;
}

/**
 * Firewall rules for one run: only One App and the allowed hosts are reachable. Requests to One App
 * get this run's token; requests carrying a secret placeholder get the real key for that host.
 */
export function networkPolicy(req: RunRequest): NetworkPolicy {
  const allow: Record<string, { match?: { headers: { value: { exact: string } }[] }; transform: { headers: Record<string, string> }[] }[]> = {};
  allow[req.appHost] = [{ transform: [{ headers: { "x-one-run": req.runToken } }] }];
  for (const h of req.hosts) allow[h] ??= [];
  for (const s of req.secrets) {
    (allow[s.host] ??= []).push({
      match: { headers: [{ value: { exact: SECRET_PREFIX + s.name } }] },
      transform: [{ headers: { [s.header.toLowerCase()]: `${s.prefix}${s.value}` } }],
    });
  }
  return { allow } as NetworkPolicy;
}

/** Production: a fresh Vercel Sandbox micro-VM per run, with the firewall above. */
export const vercelRunner: FunctionRunner = {
  name: "vercel-sandbox",
  async run(req) {
    const { Sandbox } = await import("@vercel/sandbox");
    const sandbox = await Sandbox.create({ runtime: "node22", timeout: req.timeoutMs + 30_000, resources: { vcpus: 1 }, networkPolicy: networkPolicy(req) });
    try {
      const dir = "/vercel/sandbox/fn";
      await sandbox.mkDir(dir);
      await sandbox.writeFiles(harnessFiles(req.compiled, req.input).map((f) => ({ path: `${dir}/${f.path}`, content: f.content })));
      const done = await sandbox.runCommand("node", [`${dir}/main.js`], { timeoutMs: req.timeoutMs });
      const [stdout, stderr] = await Promise.all([done.stdout(), done.stderr()]);
      return parseOutcome(stdout, stderr, done.exitCode);
    } finally {
      await sandbox.stop().catch(() => {});
    }
  },
};

/**
 * Development and tests only: runs in a local Node process (no firewall — secrets are injected by
 * the caller's fake services). Never used when deployed.
 */
export const localRunner: FunctionRunner = {
  name: "local",
  async run(req) {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawn } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "one-fn-"));
    try {
      for (const f of harnessFiles(req.compiled, req.input)) writeFileSync(join(dir, f.path), f.content);
      return await new Promise<FunctionOutcome>((resolve) => {
        const p = spawn(process.execPath, ["main.js"], { cwd: dir, env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        p.stdout.on("data", (d: Buffer) => (out += d));
        p.stderr.on("data", (d: Buffer) => (err += d));
        const t = setTimeout(() => p.kill("SIGKILL"), req.timeoutMs);
        p.on("close", (code) => {
          clearTimeout(t);
          resolve(parseOutcome(out, err, code));
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/** Vercel Sandbox when deployed on Vercel; the local runner only when explicitly enabled for dev/tests. */
export function defaultRunner(): FunctionRunner | null {
  if (process.env.VERCEL) return vercelRunner;
  if (process.env.ONE_LOCAL_FUNCTION_RUNNER === "1") return localRunner;
  return null;
}
