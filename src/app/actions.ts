"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBusiness } from "@/server/blueprints";
import { createRecord } from "@/server/records";
import { templateById, type Answers } from "@/templates";
import { resolveSeed } from "@/templates/types";
import { withLearnings } from "@/server/control";

/** Onboarding "Build it": builds the template on the server from the answers, then seeds it. */
export async function buildBusiness(input: { templateId: string; name: string; timezone: string; answers: Answers }): Promise<{ error?: string }> {
  const name = input.name.trim();
  if (!name || name.length > 80) return { error: "Give your business a name (up to 80 characters)." };
  const template = templateById(input.templateId);
  if (!template) return { error: "Pick what kind of business you run." };
  let timezone = "UTC";
  try {
    timezone = new Intl.DateTimeFormat("en", { timeZone: input.timezone }).resolvedOptions().timeZone;
  } catch {
    // unknown timezone: keep UTC
  }

  const supabase = await createClient();
  let id: string;
  try {
    const built = template.build({ name, timezone }, input.answers ?? {});
    // Starts with what owners of this kind of business were found to add (control center approvals).
    const blueprint = await withLearnings(built.blueprint);
    const { seed } = built;
    id = await createBusiness(supabase, { name, blueprint });
    // Seeds may link to earlier seeds ("@ref:<name>"): a sample car belongs to a sample customer.
    const ids = new Map<string, string>();
    for (const s of seed) {
      const row = await createRecord(supabase, id, s.table, resolveSeed(s.data, ids)).catch((e) => void console.error("seed failed", s.table, e));
      if (row && s.ref) ids.set(s.ref, row.id);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
  redirect(`/b/${id}`);
}
