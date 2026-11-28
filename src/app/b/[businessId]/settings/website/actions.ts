"use server";

import { createClient } from "@/lib/supabase/server";
import { FILES_BUCKET, filePathFor, maxBytesFor, sizeLabel } from "@/lib/files";

/** Where a website photo (hero, about, gallery, logo) is uploaded: the business's own folder. */
export async function siteImageTarget(businessId: string, name: string, size: number, mime: string): Promise<{ path: string; url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: m } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", (claims?.claims.sub as string) ?? "").maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) return { error: "Only owners and admins can change the website." };
  if (!/^image\//.test(mime)) return { error: "Pick a photo." };
  const limit = maxBytesFor(mime);
  if (!(size > 0) || size > limit) return { error: `Photos can be up to ${sizeLabel(limit)}.` };
  const path = filePathFor(businessId, "site", String(name ?? "photo").slice(0, 120));
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "Couldn’t start the upload." };
  return { path, url: data.signedUrl };
}
