import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBlueprint } from "./blueprints";
import { supabaseOwnerBackend } from "./ownerBackend";
import { recordLabel } from "@/engine/blockData";
import { customerCanCancel, optionFor, stateOf } from "@/booking/lifecycle";
import { RecordError } from "@/engine/records";
import type { Blueprint } from "@/schema/blueprint";

/**
 * A client's private link to their booking (/book/<slug>/b/<token>): see it, add it to their
 * calendar, cancel it until the business's cancel window. Made once per booking, then reused.
 */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
export const manageUrl = (slug: string, token: string) => `${appUrl()}/book/${slug}/b/${token}`;

export async function ensureBookingLink(admin: SupabaseClient, businessId: string, recordId: string): Promise<string> {
  const found = await admin.from("booking_links").select("token").eq("business_id", businessId).eq("record_id", recordId).maybeSingle();
  if (found.data?.token) return found.data.token as string;
  const token = randomBytes(24).toString("base64url");
  const ins = await admin.from("booking_links").upsert({ token, business_id: businessId, record_id: recordId }, { onConflict: "business_id,record_id", ignoreDuplicates: true });
  if (ins.error) throw new Error(`Could not make the link: ${ins.error.message}`);
  const again = await admin.from("booking_links").select("token").eq("business_id", businessId).eq("record_id", recordId).single();
  return again.data!.token as string;
}

export interface ManagedBooking {
  business: string;
  timezone: string;
  service: string;
  with: string | null;
  for: string | null;
  start: string;
  end: string;
  state: string;
  canCancel: boolean;
  cancelWindowHours: number;
}

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const admin = createAdminClient("public");
  const { data: link } = await admin.from("booking_links").select("business_id, record_id").eq("token", token).maybeSingle();
  if (!link) return null;
  const bp: Blueprint = await getCurrentBlueprint(admin, link.business_id);
  const sc = bp.scheduling;
  if (!sc) return null;
  const backend = supabaseOwnerBackend(admin, link.business_id);
  const rec = await backend.getRecord(sc.bookings.table, link.record_id).catch(() => null);
  if (!rec) return null;
  return { bp, sc, backend, rec, businessId: link.business_id as string };
}

const nameOf = async (bp: Blueprint, backend: ReturnType<typeof supabaseOwnerBackend>, table: string | undefined, id: unknown) => {
  const t = bp.tables.find((x) => x.id === table);
  if (!t || typeof id !== "string") return null;
  const r = await backend.getRecord(t.id, id).catch(() => null);
  return r ? recordLabel(t, r) : null;
};

/** What the manage page shows. Null when the link or the booking is gone. */
export async function managedBooking(token: string, now = new Date()): Promise<ManagedBooking | null> {
  const x = await load(token);
  if (!x) return null;
  const { bp, sc, backend, rec } = x;
  const start = String(rec.data[sc.bookings.start] ?? "");
  const state = stateOf(sc, rec.data[sc.bookings.status]);
  return {
    business: bp.business.name,
    timezone: bp.business.timezone,
    service: (await nameOf(bp, backend, sc.services.table, rec.data[sc.bookings.service])) ?? "Appointment",
    with: await nameOf(bp, backend, sc.practitioners.table, rec.data[sc.bookings.practitioner]),
    for: sc.for ? await nameOf(bp, backend, sc.for.table, rec.data[sc.for.booking]) : null,
    start,
    end: String(rec.data[sc.bookings.end] ?? ""),
    state,
    canCancel: state !== "cancelled" && state !== "completed" && state !== "no_show" && state !== "paid" && customerCanCancel(start, now, sc.rules.cancelWindowHours),
    cancelWindowHours: sc.rules.cancelWindowHours,
  };
}

/** The client cancels from their link; refused inside the cancel window. */
export async function cancelByLink(token: string, now = new Date()): Promise<void> {
  const x = await load(token);
  if (!x) throw new RecordError("not_found", "This booking link doesn’t work anymore.");
  const view = await managedBooking(token, now);
  if (!view?.canCancel) throw new RecordError("invalid", `This booking can’t be cancelled online anymore — please contact ${x.bp.business.name}.`);
  await x.backend.updateRecord(x.sc.bookings.table, x.rec.id, { [x.sc.bookings.status]: optionFor(x.sc, "cancelled") });
}
