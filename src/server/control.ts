import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Blueprint, type Field } from "@/schema/blueprint";
import { insightsFrom, learnedAdvice, withLearnedFields, type HistoryEntry, type Insight } from "@/engine/learning";

/**
 * The control center: One App's own people see every app their users built (setup only — never
 * a business's records), what owners change after setup, and approve what the system learns.
 * Access: signed-in users whose email is in PLATFORM_ADMIN_EMAILS.
 */

export const platformAdmins = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** The signed-in platform admin, or a 404 for everyone else (the page doesn't exist for them). */
export const requirePlatformAdmin = cache(async (): Promise<{ userId: string; email: string }> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = String(data?.claims.email ?? "").toLowerCase();
  const userId = data?.claims.sub as string | undefined;
  if (!userId || !email || !platformAdmins().includes(email)) notFound();
  return { userId, email };
});

export interface AppSummary {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  version: number;
  tables: number;
  pages: number;
  components: number;
  automations: number;
  records: number;
  ownerChanges: number;
  aiChanges: number;
  lastChangeAt?: string;
}

const parseBp = (json: unknown): Blueprint | null => {
  const r = Blueprint.safeParse(json);
  return r.success ? r.data : null;
};

async function latestBlueprints(admin: ReturnType<typeof createAdminClient>, ids?: string[]) {
  let q = admin.from("blueprints").select("business_id, version, json").order("version", { ascending: false });
  if (ids) q = q.in("business_id", ids);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  const out = new Map<string, { version: number; bp: Blueprint | null }>();
  for (const r of data ?? []) if (!out.has(r.business_id)) out.set(r.business_id, { version: r.version, bp: parseBp(r.json) });
  return out;
}

async function historyFor(admin: ReturnType<typeof createAdminClient>, ids?: string[]): Promise<HistoryEntry[]> {
  let q = admin.from("blueprint_history").select("id, business_id, source, created_at, undoes, change_set, inverse").order("created_at", { ascending: true });
  if (ids) q = q.in("business_id", ids);
  const { data, error } = await q.limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((h) => ({ id: h.id, businessId: h.business_id, source: h.source, createdAt: h.created_at, undoes: h.undoes, changeSet: h.change_set ?? {}, inverse: h.inverse ?? {} }));
}

/** Every business with the size of its app and how much its owner changed it. */
export async function listApps(): Promise<AppSummary[]> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: businesses, error } = await admin.from("businesses").select("id, name, type, created_at").order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  const [bps, history, counts] = await Promise.all([
    latestBlueprints(admin),
    historyFor(admin),
    admin.rpc("platform_record_counts").then((r) => (r.error ? [] : ((r.data ?? []) as { business_id: string; n: number }[]))),
  ]);
  const recordCount = new Map(counts.map((c) => [c.business_id, Number(c.n)]));
  return (businesses ?? []).map((b) => {
    const cur = bps.get(b.id);
    const mine = history.filter((h) => h.businessId === b.id && h.source !== "system");
    return {
      id: b.id,
      name: b.name,
      type: b.type,
      createdAt: b.created_at,
      version: cur?.version ?? 0,
      tables: cur?.bp?.tables.length ?? 0,
      pages: cur?.bp?.pages.filter((p) => !p.recordOf).length ?? 0,
      components: cur?.bp?.components?.length ?? 0,
      automations: cur?.bp?.automations.length ?? 0,
      records: recordCount.get(b.id) ?? 0,
      ownerChanges: mine.filter((h) => h.source === "ui").length,
      aiChanges: mine.filter((h) => h.source === "ai").length,
      lastChangeAt: mine.at(-1)?.createdAt,
    };
  });
}

/** One business's app: its current setup and the story of how it changed. */
export async function loadApp(id: string) {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: b } = await admin.from("businesses").select("id, name, type, created_at").eq("id", id).maybeSingle();
  if (!b) notFound();
  const bps = await latestBlueprints(admin, [id]);
  const bp = bps.get(id)?.bp;
  if (!bp) notFound();
  const { data: history } = await admin.from("blueprint_history").select("id, source, summary, created_at, from_version, to_version, undoes").eq("business_id", id).order("created_at", { ascending: false }).limit(200);
  return { business: b, blueprint: bp, history: history ?? [] };
}

export interface LearningRow {
  id: string;
  business_type: string;
  pattern: string;
  kind: string;
  text: string;
  payload: { tableLabel: string; field: Field } | null;
  status: "advice" | "template" | "dismissed";
  businesses: number;
  decided_at: string;
}

/** Patterns across all apps (newest decisions attached) — what to fold back into the system. */
export async function loadInsights(): Promise<{ insights: (Insight & { decision?: LearningRow })[]; types: { type: string; count: number }[]; decided: LearningRow[] }> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: businesses } = await admin.from("businesses").select("id, type").limit(5000);
  const list = (businesses ?? []) as { id: string; type: string }[];
  const [bps, history, { data: decided }] = await Promise.all([latestBlueprints(admin), historyFor(admin), admin.from("platform_learnings").select("*").order("decided_at", { ascending: false })]);
  const blueprints = new Map([...bps].filter(([, v]) => v.bp).map(([k, v]) => [k, v.bp!]));
  const byKey = new Map(((decided ?? []) as LearningRow[]).map((d) => [`${d.business_type}::${d.pattern}`, d]));
  const insights = insightsFrom(list, history, blueprints).map((i) => ({ ...i, decision: byKey.get(`${i.businessType}::${i.key}`) }));
  const types = [...list.reduce((m, b) => m.set(b.type, (m.get(b.type) ?? 0) + 1), new Map<string, number>())].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  return { insights, types, decided: (decided ?? []) as LearningRow[] };
}

/** Approve a pattern as builder advice or as a template addition (fields), or dismiss it. */
export async function decideLearning(input: { businessType: string; pattern: string; kind: string; text: string; payload?: unknown; businesses: number; status: LearningRow["status"] | "undecided" }) {
  const { userId } = await requirePlatformAdmin();
  const admin = createAdminClient();
  if (input.status === "undecided") {
    await admin.from("platform_learnings").delete().eq("business_type", input.businessType).eq("pattern", input.pattern);
    return;
  }
  if (input.status === "template" && input.kind !== "field") throw new Error("Only fields can be added to templates for now.");
  const { error } = await admin.from("platform_learnings").upsert(
    {
      business_type: input.businessType.slice(0, 60),
      pattern: input.pattern.slice(0, 300),
      kind: input.kind.slice(0, 30),
      text: input.text.slice(0, 500),
      payload: input.status === "template" ? (input.payload ?? null) : null,
      status: input.status,
      businesses: input.businesses,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "business_type,pattern" },
  );
  if (error) throw new Error(error.message);
}

/** Approved learnings for a business type (used when building a new app and by the builder). */
export async function approvedLearnings(businessType: string): Promise<{ advice: string; fields: { tableLabel: string; field: Field }[] }> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("platform_learnings").select("text, status, payload").eq("business_type", businessType).in("status", ["advice", "template"]).order("businesses", { ascending: false }).limit(40);
    const rows = (data ?? []) as { text: string; status: string; payload: { tableLabel: string; field: Field } | null }[];
    return {
      advice: learnedAdvice(businessType, rows.map((r) => r.text)),
      fields: rows.filter((r) => r.status === "template" && r.payload?.field).map((r) => r.payload!),
    };
  } catch {
    // Learnings are a bonus: never block building or chatting on them.
    return { advice: "", fields: [] };
  }
}

/** A freshly built template plus the fields owners of that type approved-ly always add. */
export async function withLearnings(bp: Blueprint): Promise<Blueprint> {
  const { fields } = await approvedLearnings(bp.business.type);
  if (!fields.length) return bp;
  const next = withLearnedFields(bp, fields);
  return Blueprint.safeParse(next).success ? next : bp;
}
