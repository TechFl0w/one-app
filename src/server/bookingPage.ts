import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Blueprint } from "@/schema/blueprint";
import { slugify } from "@/email/compose";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseOwnerBackend } from "./ownerBackend";

export interface BookingPage {
  businessId: string;
  slug: string;
  enabled: boolean;
  intro: string | null;
}
type Row = { business_id: string; slug: string; enabled: boolean; intro: string | null };
/** Full public link for a booking page slug (relative when the app URL isn't configured). */
export function bookingPageUrl(slug: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/book/${slug}`;
}

const toPage = (r: Row): BookingPage => ({ businessId: r.business_id, slug: r.slug, enabled: r.enabled, intro: r.intro });

/** The business's booking page, created (enabled, slug from the name) on first use. Owner/admin client. */
export async function ensureBookingPage(db: SupabaseClient, businessId: string, name: string): Promise<BookingPage> {
  const { data, error } = await db.from("booking_pages").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not load booking page: ${error.message}`);
  if (data) return toPage(data as Row);
  const base = slugify(name);
  for (const slug of [base, `${base}-${Math.random().toString(36).slice(2, 6)}`, `${base}-${Math.random().toString(36).slice(2, 8)}`]) {
    const ins = await db.from("booking_pages").insert({ business_id: businessId, slug }).select("*").single();
    if (!ins.error) return toPage(ins.data as Row);
    if (ins.error.code !== "23505") throw new Error(`Could not set up the booking page: ${ins.error.message}`);
  }
  throw new Error("Could not find a free booking link");
}

export async function updateBookingPage(db: SupabaseClient, businessId: string, patch: { enabled: boolean; intro: string | null }) {
  const { error } = await db.from("booking_pages").update({ ...patch, updated_at: new Date().toISOString() }).eq("business_id", businessId);
  if (error) throw new Error(`Could not save: ${error.message}`);
}

/**
 * Everything the public page needs for one slug: the business's blueprint and a backend scoped
 * to it. Uses the service role (visitors aren't signed in); every call is limited to this business.
 */
export async function publicBooking(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return null;
  const admin = createAdminClient("public");
  const { data } = await admin.from("booking_pages").select("*").eq("slug", slug).eq("enabled", true).maybeSingle();
  if (!data) return null;
  const page = toPage(data as Row);
  const { data: bp } = await admin.from("current_blueprints").select("json").eq("business_id", page.businessId).maybeSingle();
  const blueprint = bp ? Blueprint.safeParse(bp.json) : null;
  if (!blueprint?.success || !blueprint.data.scheduling) return null;
  return { page, blueprint: blueprint.data, backend: supabaseOwnerBackend(admin, page.businessId) };
}
