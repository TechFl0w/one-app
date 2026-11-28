import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBlueprint } from "./blueprints";
import { supabaseOwnerBackend } from "./ownerBackend";
import { recordLabel } from "@/engine/blockData";
import { stateOf } from "@/booking/lifecycle";
import { icsFeed, type FeedEvent } from "@/engine/ics";

/**
 * Private calendar feeds: the owner (or a staff member) subscribes from Google, Apple or Outlook
 * and sees bookings there, kept up to date. The link is the key — it can be replaced if shared.
 */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
export const feedUrl = (token: string) => `${appUrl()}/api/cal/${token}.ics`;

export async function ensureFeed(admin: SupabaseClient, businessId: string, personId: string | null): Promise<string> {
  const q = admin.from("calendar_feeds").select("token").eq("business_id", businessId);
  const { data } = await (personId ? q.eq("person_id", personId) : q.is("person_id", null)).maybeSingle();
  if (data?.token) return data.token as string;
  const token = randomBytes(24).toString("base64url");
  const { error } = await admin.from("calendar_feeds").insert({ token, business_id: businessId, person_id: personId });
  if (error) throw new Error(`Could not make the feed: ${error.message}`);
  return token;
}

/** A new link (the old one stops working), when it was shared by mistake. */
export async function resetFeed(admin: SupabaseClient, businessId: string, personId: string | null): Promise<string> {
  const q = admin.from("calendar_feeds").delete().eq("business_id", businessId);
  await (personId ? q.eq("person_id", personId) : q.is("person_id", null));
  return ensureFeed(admin, businessId, personId);
}

/** The feed's contents: bookings from 30 days back to a year ahead, without cancelled ones. */
export async function feedFor(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const admin = createAdminClient("public");
  const { data: feed } = await admin.from("calendar_feeds").select("business_id, person_id").eq("token", token).maybeSingle();
  if (!feed) return null;
  await admin.from("calendar_feeds").update({ last_read_at: new Date().toISOString() }).eq("token", token);
  const bp = await getCurrentBlueprint(admin, feed.business_id);
  const sc = bp.scheduling;
  const b = supabaseOwnerBackend(admin, feed.business_id);
  if (!sc) return icsFeed(bp.business.name, []);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const page = await b.query({ table: sc.bookings.table, filters: [{ field: sc.bookings.start, op: "gte", value: from }, { field: sc.bookings.start, op: "lt", value: to }, ...(feed.person_id ? [{ field: sc.bookings.practitioner, op: "eq" as const, value: feed.person_id as string }] : [])], limit: 500, offset });
    rows.push(...page.records);
    if (page.records.length < 500) break;
  }
  const names = async (table: string, ids: unknown[]) => {
    const t = bp.tables.find((x) => x.id === table);
    const want = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
    const out = new Map<string, string>();
    if (!t || !want.length) return out;
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = await b.query({ table, limit: 500, offset });
      for (const r of page.records) if (want.includes(r.id)) out.set(r.id, recordLabel(t, r));
      if (page.records.length < 500 || out.size === want.length) break;
    }
    return out;
  };
  const [services, people, clients] = await Promise.all([
    names(sc.services.table, rows.map((r) => r.data[sc.bookings.service])),
    names(sc.practitioners.table, rows.map((r) => r.data[sc.bookings.practitioner])),
    names(sc.clients.table, rows.map((r) => r.data[sc.bookings.client])),
  ]);
  const events: FeedEvent[] = rows
    .filter((r) => { const s = stateOf(sc, r.data[sc.bookings.status]); return s !== "cancelled" && s !== "no_show"; })
    .map((r) => {
      const svc = services.get(String(r.data[sc.bookings.service])) ?? "Booking";
      const client = clients.get(String(r.data[sc.bookings.client]));
      const who = people.get(String(r.data[sc.bookings.practitioner]));
      return {
        id: r.id,
        start: String(r.data[sc.bookings.start]),
        end: String(r.data[sc.bookings.end]),
        title: client ? `${svc} — ${client}` : svc,
        description: [who && !feed.person_id ? `With ${who}` : null, `${appUrl()}/b/${feed.business_id}/r/${sc.bookings.table}/${r.id}`].filter(Boolean).join("\n"),
        ...(bp.business.address ? { location: bp.business.address } : {}),
      };
    });
  return icsFeed(feed.person_id ? `${bp.business.name} — ${people.get(feed.person_id) ?? "my bookings"}` : bp.business.name, events);
}
