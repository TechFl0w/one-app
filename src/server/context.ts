import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { userAgent } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBlueprint } from "./blueprints";
import { ChangeSetError } from "@/engine/changeSet";
import { deviceFromUserAgent, type Device } from "@/engine/layout";

/** Per-request business context, shared by layouts and pages (React cache dedupes it). */
export const getBusinessContext = cache(async (businessId: string) => {
  const supabase = await createClient();
  const [{ data: claims }, blueprint, { data: businesses }] = await Promise.all([
    supabase.auth.getClaims(),
    getCurrentBlueprint(supabase, businessId).catch((e) => {
      if (e instanceof ChangeSetError && e.code === "not_found") notFound();
      throw e;
    }),
    supabase.from("businesses").select("id, name").order("created_at"),
  ]);
  return {
    supabase,
    blueprint,
    userId: claims?.claims.sub as string | undefined,
    businesses: (businesses ?? []) as { id: string; name: string }[],
  };
});

export const getDevice = cache(async (): Promise<Device> => deviceFromUserAgent(userAgent({ headers: await headers() })));
