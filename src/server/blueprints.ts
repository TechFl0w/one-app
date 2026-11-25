import "server-only";
import { componentsOn, restorePageOps, touchesPage } from "@/engine/pageHistory";
import { checkReferences } from "@/codegen/references";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Blueprint, emptyBlueprint } from "@/schema/blueprint";
import { ChangeSet } from "@/schema/changeSet";
import { applyChangeSet, ChangeSetError, previewChangeSet, undoChangeSet, type ChangeSetResult } from "@/engine/changeSet";

/**
 * Persistence for blueprints. All writes go through `applyChangeSet` (pure, validated) and then
 * `commit_blueprint_version` (atomic, version-checked, RLS-enforced). Callers pass a Supabase
 * client acting as the signed-in user, so a user can only touch businesses they belong to.
 */

export async function createBusiness(
  supabase: SupabaseClient,
  input: { name: string; type?: string; timezone?: string; blueprint?: Blueprint },
): Promise<string> {
  const business = {
    name: input.name,
    type: input.blueprint?.business.type ?? input.type ?? "other",
    timezone: input.blueprint?.business.timezone ?? input.timezone ?? "UTC",
  };
  const blueprint = input.blueprint ? Blueprint.parse({ ...input.blueprint, version: 1, business: { ...input.blueprint.business, name: input.name } }) : emptyBlueprint(business);
  const { data, error } = await supabase.rpc("create_business", {
    p_name: business.name,
    p_type: business.type,
    p_timezone: business.timezone,
    p_blueprint: blueprint,
  });
  if (error) throw new Error(`Could not create business: ${error.message}`);
  return data as string;
}

export async function getCurrentBlueprint(supabase: SupabaseClient, businessId: string): Promise<Blueprint> {
  const { data, error } = await supabase
    .from("current_blueprints")
    .select("json")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`Could not load blueprint: ${error.message}`);
  if (!data) throw new ChangeSetError("not_found", "Business not found");
  return Blueprint.parse(data.json);
}

export async function previewChange(supabase: SupabaseClient, businessId: string, changeSet: unknown) {
  return previewChangeSet(await getCurrentBlueprint(supabase, businessId), changeSet);
}

/** Applies and stores a change set. Throws ChangeSetError (incl. `conflict` if someone else saved first). */
export async function commitChangeSet(
  supabase: SupabaseClient,
  businessId: string,
  changeSet: unknown,
  opts: { confirmed?: boolean } = {},
): Promise<ChangeSetResult & { historyId: string }> {
  const current = await getCurrentBlueprint(supabase, businessId);
  const cs = ChangeSet.parse(changeSet);
  const result = applyChangeSet(current, cs, opts);
  const historyId = await commit(supabase, businessId, current.version, result, cs);
  return { ...result, historyId };
}

/** Undoes a history entry by applying its stored inverse to the current blueprint. */
export async function undoHistoryEntry(
  supabase: SupabaseClient,
  businessId: string,
  historyId: string,
  opts: { confirmed?: boolean } = {},
): Promise<ChangeSetResult & { historyId: string }> {
  const { data, error } = await supabase
    .from("blueprint_history")
    .select("inverse, summary")
    .eq("business_id", businessId)
    .eq("id", historyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load history: ${error.message}`);
  if (!data) throw new ChangeSetError("not_found", "History entry not found");
  const inverse = ChangeSet.safeParse(data.inverse);
  if (!inverse.success) throw new ChangeSetError("invalid", "This change cannot be undone");

  const current = await getCurrentBlueprint(supabase, businessId);
  const result = undoChangeSet(current, inverse.data, opts);
  const cs = { ...inverse.data, baseVersion: current.version, source: "undo" as const };
  const newId = await commit(supabase, businessId, current.version, result, cs, historyId);
  return { ...result, historyId: newId };
}

async function commit(
  supabase: SupabaseClient,
  businessId: string,
  expectedVersion: number,
  result: ChangeSetResult,
  cs: ChangeSet,
  undoes?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("commit_blueprint_version", {
    p_business_id: businessId,
    p_expected_version: expectedVersion,
    p_blueprint: result.blueprint,
    p_source: cs.source,
    p_summary: cs.summary ?? result.ops.map((o) => o.description).join("; ").slice(0, 500),
    p_change_set: cs,
    p_inverse: result.inverse,
    p_undoes: undoes ?? null,
  });
  if (error) {
    if (error.code === "40001") throw new ChangeSetError("conflict", "Someone else changed this just now — reload and try again");
    throw new Error(`Could not save change: ${error.message}`);
  }
  return data as string;
}

/** Earlier versions of one page, newest first (from the setup history). */
export async function pageVersions(supabase: SupabaseClient, businessId: string, pageId: string) {
  const current = await getCurrentBlueprint(supabase, businessId);
  const { data, error } = await supabase
    .from("blueprint_history")
    .select("id, from_version, to_version, source, summary, change_set, created_at")
    .eq("business_id", businessId)
    .order("to_version", { ascending: false })
    .limit(300);
  if (error) throw new Error(`Could not load history: ${error.message}`);
  const screens = componentsOn(current.pages.find((p) => p.id === pageId));
  return (data ?? [])
    .filter((h) => touchesPage(((h.change_set as { ops?: unknown[] })?.ops ?? []) as unknown[], pageId, screens))
    .slice(0, 50)
    .map((h) => ({ id: h.id as string, version: h.to_version as number, before: h.from_version as number, source: h.source as string, summary: h.summary as string, at: h.created_at as string }));
}

/** Puts a page back the way it was in `version` (as a new, undoable change). */
export async function restorePage(supabase: SupabaseClient, businessId: string, pageId: string, version: number) {
  const current = await getCurrentBlueprint(supabase, businessId);
  const { data, error } = await supabase.from("blueprints").select("json, created_at").eq("business_id", businessId).eq("version", version).maybeSingle();
  if (error) throw new Error(`Could not load that version: ${error.message}`);
  if (!data) throw new ChangeSetError("not_found", "That version is no longer available");
  const old = Blueprint.parse(data.json);
  const ops = restorePageOps(current, old, pageId);
  if (!ops.length) return null;
  // A screen from back then may use fields removed since; don't restore something that would break.
  for (const op of ops) {
    if (op.op !== "putComponent") continue;
    const missing = checkReferences(op.component.source, current);
    if (missing.length) throw new ChangeSetError("invalid", `That version of “${op.component.label}” uses things that have been removed since, so it can't come back as it was.`);
  }
  const label = old.pages.find((p) => p.id === pageId)?.label ?? "page";
  const when = new Date(data.created_at as string).toISOString().slice(0, 16).replace("T", " ");
  return commitChangeSet(supabase, businessId, { baseVersion: current.version, source: "ui", summary: `Restore “${label}” to the version of ${when}`, ops });
}
