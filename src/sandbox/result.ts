import { ZodError } from "zod";

/**
 * What a bridge call returns. Server actions can't throw useful errors (production replaces the
 * message with a digest), so failures come back as data with a code the component, the owner and
 * the assistant can act on.
 */
export type BridgeResult<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

const codeOf = (e: unknown) => {
  if (e instanceof ZodError) return "invalid_query";
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" && /^[a-z_]{1,40}$/.test(c) ? c : "error";
};
const messageOf = (e: unknown) => {
  if (e instanceof ZodError) return e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : "Something went wrong";
};

export async function bridged<T>(fn: () => Promise<T>): Promise<BridgeResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, code: codeOf(e), error: messageOf(e).slice(0, 300) };
  }
}

export function unwrap<T>(r: BridgeResult<T>): T {
  if (r.ok) return r.value;
  throw new Error(`${r.code}: ${r.error}`);
}
