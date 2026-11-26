"use server";

import { decideFromLink, payFromLink } from "@/server/documents";

/** The customer's answers on a document link. Errors come back as text for the page to show. */
export async function decideDocument(token: string, decision: "accept" | "decline", name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await decideFromLink(token, decision, String(name ?? "").slice(0, 200));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function payDocument(token: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    return { ok: true, url: await payFromLink(token) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
