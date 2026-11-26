import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Blueprint } from "@/schema/blueprint";
import { sampleRecords } from "@/engine/sampleRecords";
import { requirePlatformAdmin } from "./control";

/** A user's app with made-up records, for the control center (their real data is never loaded). */
export const previewApp = cache(async (businessId: string) => {
  await requirePlatformAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound();
  const admin = createAdminClient();
  const { data } = await admin.from("blueprints").select("json").eq("business_id", businessId).order("version", { ascending: false }).limit(1).maybeSingle();
  const parsed = Blueprint.safeParse(data?.json);
  if (!parsed.success) notFound();
  return { blueprint: parsed.data, records: sampleRecords(parsed.data) };
});
