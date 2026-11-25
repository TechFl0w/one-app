"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createToken, revokeToken } from "@/server/mcp";
import { loadPending, resolvePending } from "@/server/ownerChat";
import { supabaseOwnerBackend } from "@/server/ownerBackend";
import { runConfirmedAction } from "@/agent/ownerAgent";

async function requireManager(businessId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = (claims?.claims.sub as string | undefined) ?? "";
  const { data } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid).maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Only owners and admins can do this");
  return { supabase, uid };
}

export async function createTokenAction(businessId: string, name: string): Promise<{ token?: string; message?: string }> {
  try {
    const { uid } = await requireManager(businessId);
    if (!name.trim()) return { message: "Give it a name, like “Claude on my laptop”." };
    const token = await createToken(createAdminClient(), businessId, uid, name.trim());
    revalidatePath(`/b/${businessId}/settings/connections`);
    return { token };
  } catch (e) {
    return { message: e instanceof Error ? e.message : "Couldn’t create it." };
  }
}

export async function revokeTokenAction(businessId: string, id: string) {
  const { uid } = await requireManager(businessId);
  await revokeToken(createAdminClient(), businessId, uid, id);
  revalidatePath(`/b/${businessId}/settings/connections`);
}

/** Approve or decline a risky action an AI app asked for. Runs as the signed-in owner. */
export async function resolveApproval(businessId: string, id: string, approve: boolean): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireManager(businessId);
  const [action] = await loadPending(supabase, businessId, [id]);
  if (!action) return { ok: false, message: "Already handled." };
  if (!approve) {
    await resolvePending(supabase, [id], "cancelled");
  } else {
    const r = await runConfirmedAction(supabaseOwnerBackend(supabase, businessId), action);
    await resolvePending(supabase, [id], r.ok ? "confirmed" : "failed");
    if (!r.ok) {
      revalidatePath(`/b/${businessId}`, "layout");
      return { ok: false, message: r.note.replace(/^\[The owner confirmed, but it failed: /, "").replace(/\]$/, "") };
    }
  }
  revalidatePath(`/b/${businessId}`, "layout");
  return { ok: true };
}
