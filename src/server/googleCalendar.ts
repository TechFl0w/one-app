import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blueprint } from "@/schema/blueprint";
import { stateOf } from "@/booking/lifecycle";
import { recordLabel } from "@/engine/blockData";
import type { ExternalBusy } from "@/booking/service";
import { busyTimes, deleteEvent, googleConfigured, GoogleError, refreshAccess, upsertEvent } from "@/integrations/googleCalendar";
import { supabaseOwnerBackend } from "./ownerBackend";

/**
 * Google Calendar for a business: the business's own calendar and each staff member's. Bookings
 * are written there (and removed when cancelled); staff calendars' busy times block booking.
 */

type Conn = { id: string; business_id: string; person_id: string | null; account_email: string | null; refresh_token: string; access_token: string | null; expires_at: string | null; calendar_id: string; status: string };

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
export const googleRedirectUri = (origin = appUrl()) => `${origin}/api/integrations/google/callback`;

/** The sign-in round trip carries who is connecting what, signed so it can't be swapped. */
export function signState(v: { businessId: string; personId: string | null; userId: string; origin: string }): string {
  const body = Buffer.from(JSON.stringify({ ...v, at: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET ?? "").update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function readState(state: string): { businessId: string; personId: string | null; userId: string; origin: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET ?? "").update(body).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { businessId: string; personId: string | null; userId: string; origin: string; at: number };
  return Date.now() - v.at < 15 * 60_000 ? v : null;
}

export async function saveConnection(admin: SupabaseClient, v: { businessId: string; personId: string | null; userId: string; email: string | null; refreshToken: string; accessToken: string; expiresIn: number }) {
  const row = { business_id: v.businessId, person_id: v.personId, provider: "google", account_email: v.email, refresh_token: v.refreshToken, access_token: v.accessToken, expires_at: new Date(Date.now() + (v.expiresIn - 60) * 1000).toISOString(), status: "ok", last_error: null, connected_by: v.userId, updated_at: new Date().toISOString() };
  const q = admin.from("calendar_connections").delete().eq("business_id", v.businessId).eq("provider", "google");
  await (v.personId ? q.eq("person_id", v.personId) : q.is("person_id", null));
  const { error } = await admin.from("calendar_connections").insert(row);
  if (error) throw new Error(`Couldn’t save the connection: ${error.message}`);
}

export async function removeConnection(admin: SupabaseClient, businessId: string, personId: string | null) {
  const q = admin.from("calendar_connections").delete().eq("business_id", businessId).eq("provider", "google");
  await (personId ? q.eq("person_id", personId) : q.is("person_id", null));
}

export async function listConnections(admin: SupabaseClient, businessId: string): Promise<{ personId: string | null; email: string | null; ok: boolean; error: string | null }[]> {
  const { data } = await admin.from("calendar_connections").select("person_id, account_email, status, last_error").eq("business_id", businessId).eq("provider", "google");
  return (data ?? []).map((c) => ({ personId: c.person_id as string | null, email: c.account_email as string | null, ok: c.status === "ok", error: c.last_error as string | null }));
}

async function connections(admin: SupabaseClient, businessId: string): Promise<Conn[]> {
  if (!googleConfigured()) return [];
  const { data } = await admin.from("calendar_connections").select("*").eq("business_id", businessId).eq("provider", "google").eq("status", "ok");
  return (data ?? []) as Conn[];
}

/** A working access token: the stored one, or a fresh one. A removed access marks the connection. */
async function token(admin: SupabaseClient, c: Conn): Promise<string | null> {
  if (c.access_token && c.expires_at && Date.parse(c.expires_at) > Date.now()) return c.access_token;
  try {
    const t = await refreshAccess(c.refresh_token);
    await admin.from("calendar_connections").update({ access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleError && e.revoked) await markBroken(admin, c, "Google access was removed — connect again");
    return null;
  }
}
const markBroken = (admin: SupabaseClient, c: Conn, why: string) => admin.from("calendar_connections").update({ status: "error", last_error: why, updated_at: new Date().toISOString() }).eq("id", c.id);

/**
 * Writes one booking to the calendars it belongs in (the business's, its staff member's), or
 * removes it there when it's cancelled, a no-show or deleted.
 */
export async function syncBooking(admin: SupabaseClient, bp: Blueprint, businessId: string, recordId: string, data: Record<string, unknown> | null, before: Record<string, unknown> | null): Promise<void> {
  const sc = bp.scheduling;
  if (!sc) return;
  const conns = await connections(admin, businessId);
  if (!conns.length) return;
  const who = data ? (data[sc.bookings.practitioner] as string | undefined) : undefined;
  const was = before ? (before[sc.bookings.practitioner] as string | undefined) : undefined;
  const state = data ? stateOf(sc, data[sc.bookings.status]) : "cancelled";
  const gone = !data || state === "cancelled" || state === "no_show";
  const start = data ? String(data[sc.bookings.start] ?? "") : "";
  const end = data ? String(data[sc.bookings.end] ?? "") : "";

  let event: { summary: string; description: string; location?: string; start: string; end: string } | null = null;
  if (!gone && Date.parse(start) && Date.parse(end)) {
    const b = supabaseOwnerBackend(admin, businessId);
    const name = async (table: string, id: unknown) => {
      const t = bp.tables.find((x) => x.id === table);
      if (!t || typeof id !== "string") return null;
      const r = await b.getRecord(table, id).catch(() => null);
      return r ? recordLabel(t, r) : null;
    };
    const [service, client, person, pet] = await Promise.all([
      name(sc.services.table, data![sc.bookings.service]),
      name(sc.clients.table, data![sc.bookings.client]),
      name(sc.practitioners.table, who),
      sc.for ? name(sc.for.table, data![sc.for.booking]) : Promise.resolve(null),
    ]);
    event = {
      summary: [service ?? "Booking", [pet, client].filter(Boolean).join(" · ")].filter(Boolean).join(" — "),
      description: [person ? `With ${person}` : null, state === "requested" ? "Waiting for confirmation" : null, `${appUrl()}/b/${businessId}/r/${sc.bookings.table}/${recordId}`].filter(Boolean).join("\n"),
      ...(bp.business.address ? { location: bp.business.address } : {}),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    };
  }
  for (const c of conns) {
    // The business calendar has every booking; a staff calendar only theirs.
    const mine = c.person_id === null || c.person_id === who;
    const wasMine = c.person_id !== null && c.person_id === was && was !== who;
    if (!mine && !wasMine) continue;
    const t = await token(admin, c);
    if (!t) continue;
    try {
      if (event && mine) await upsertEvent(t, c.calendar_id, recordId, event);
      else await deleteEvent(t, c.calendar_id, recordId);
    } catch (e) {
      if (e instanceof GoogleError && e.revoked) await markBroken(admin, c, "Google access was removed — connect again");
      else console.error("google calendar sync", businessId, recordId, e);
    }
  }
}

/** Busy times from staff members' own Google calendars, for the booking engine. */
export function googleBusy(admin: SupabaseClient, businessId: string): ExternalBusy {
  return async (people, from, to) => {
    const out = new Map<string, { start: number; end: number }[]>();
    for (const c of await connections(admin, businessId)) {
      if (!c.person_id || !people.includes(c.person_id)) continue;
      const t = await token(admin, c);
      if (!t) continue;
      out.set(c.person_id, await busyTimes(t, c.calendar_id, from, to).catch(() => []));
    }
    return out;
  };
}
