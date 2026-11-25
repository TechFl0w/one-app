"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inSessionWindow, toE164 } from "@/whatsapp/core";
import { buyNumber, refreshLine, registerSender, searchNumbers, sendWhatsApp, submitStarterTemplates } from "@/server/whatsapp";
import { ensureEmailSettings } from "@/server/email";
import { getCurrentBlueprint } from "@/server/blueprints";

export type WaState = { ok?: boolean; message?: string };

/** Owners/admins only — checked as the signed-in user before the service role is used. */
async function requireManager(businessId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub as string | undefined;
  const { data } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid ?? "").maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Only owners and admins can manage WhatsApp");
  return supabase;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const settingsPath = (b: string) => `/b/${b}/settings/whatsapp`;

export async function findNumbers(businessId: string, country: "CA" | "US", areaCode?: number) {
  await requireManager(businessId);
  return searchNumbers(country, areaCode);
}

export async function buyNumberAction(businessId: string, phone: string): Promise<WaState> {
  try {
    const supabase = await requireManager(businessId);
    const bp = await getCurrentBlueprint(supabase, businessId);
    const e164 = toE164(phone);
    if (!e164) return { ok: false, message: "That number doesn’t look right." };
    await buyNumber(createAdminClient(), businessId, e164, bp.business.name);
    revalidatePath(settingsPath(businessId));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function connectSenderAction(businessId: string, wabaId: string, displayName: string): Promise<WaState> {
  try {
    await requireManager(businessId);
    if (!/^\d{5,25}$/.test(wabaId.trim())) return { ok: false, message: "The WhatsApp Business Account id is a long number." };
    if (!displayName.trim()) return { ok: false, message: "Add the name customers will see." };
    await registerSender(createAdminClient(), businessId, wabaId.trim(), displayName.trim().slice(0, 100));
    revalidatePath(settingsPath(businessId));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function refreshLineAction(businessId: string): Promise<WaState> {
  try {
    const supabase = await requireManager(businessId);
    const admin = createAdminClient();
    const line = await refreshLine(admin, businessId);
    if (line?.status === "online") {
      const settings = await ensureEmailSettings(supabase, businessId, (await getCurrentBlueprint(supabase, businessId)).business.name);
      await submitStarterTemplates(admin, businessId, settings.slug);
    }
    revalidatePath(settingsPath(businessId));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

// ---------- conversations ----------

export async function replyAction(businessId: string, conversationId: string, body: string): Promise<WaState> {
  try {
    const supabase = await requireManager(businessId);
    const text = body.trim().slice(0, 4000);
    if (!text) return { ok: false, message: "Write a message first." };
    const { data: conv } = await supabase.from("conversations").select("customer_phone, last_inbound_at").eq("business_id", businessId).eq("id", conversationId).maybeSingle();
    if (!conv) return { ok: false, message: "Conversation not found." };
    if (!inSessionWindow(conv.last_inbound_at)) return { ok: false, message: "WhatsApp only allows free replies within 24 hours of the customer’s last message." };
    await sendWhatsApp(createAdminClient(), businessId, conv.customer_phone, { body: text }, { author: "owner" });
    // Replying yourself means you've taken over.
    await supabase.from("conversations").update({ mode: "owner", unread: 0 }).eq("business_id", businessId).eq("id", conversationId);
    revalidatePath(`/b/${businessId}/inbox`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function setConversationMode(businessId: string, conversationId: string, mode: "agent" | "owner") {
  const supabase = await requireManager(businessId);
  await supabase.from("conversations").update({ mode }).eq("business_id", businessId).eq("id", conversationId);
  revalidatePath(`/b/${businessId}/inbox`);
}

export async function markConversationRead(businessId: string, conversationId: string) {
  const supabase = await createClient();
  await supabase.from("conversations").update({ unread: 0 }).eq("business_id", businessId).eq("id", conversationId).gt("unread", 0);
  revalidatePath(`/b/${businessId}`, "layout");
}

export async function conversationMessages(businessId: string, conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_messages")
    .select("id, direction, author, body, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []) as { id: number; direction: "in" | "out"; author: string; body: string; created_at: string }[];
}
