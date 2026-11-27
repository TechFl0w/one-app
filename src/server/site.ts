import "server-only";
import { Blueprint } from "@/schema/blueprint";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseOwnerBackend } from "./ownerBackend";
import { FILES_BUCKET, isBusinessFilePath } from "@/lib/files";

/**
 * The public website at /s/<slug> (the same slug as the booking page). Uses the service role
 * (visitors aren't signed in); everything is limited to the one business the slug belongs to.
 */
export async function publicSite(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return null;
  const admin = createAdminClient("public");
  const { data } = await admin.from("booking_pages").select("business_id, slug, enabled").eq("slug", slug).maybeSingle();
  if (!data) return null;
  const { data: bp } = await admin.from("current_blueprints").select("json").eq("business_id", data.business_id).maybeSingle();
  const parsed = bp ? Blueprint.safeParse(bp.json) : null;
  if (!parsed?.success || !parsed.data.site?.enabled) return null;
  return { blueprint: parsed.data, businessId: data.business_id as string, slug, bookingOn: !!data.enabled && !!parsed.data.scheduling, backend: supabaseOwnerBackend(admin, data.business_id as string) };
}

/** Signed links for the site's photos (only files of this business). */
export async function signPhotos(businessId: string, paths: (string | undefined)[]): Promise<Record<string, string>> {
  const mine = [...new Set(paths.filter((p): p is string => !!p && isBusinessFilePath(businessId, p)))];
  if (!mine.length) return {};
  const { data } = await createAdminClient("public").storage.from(FILES_BUCKET).createSignedUrls(mine, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path!, d.signedUrl as string]));
}
