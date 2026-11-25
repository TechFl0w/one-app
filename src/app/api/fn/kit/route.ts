import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessForRunToken } from "@/server/functions";
import { createRecord, getRecord, listRecords, updateRecord } from "@/server/records";
import { RecordQuery } from "@/schema/records";

/**
 * The kit API for generated server functions. The caller is identified only by the run token the
 * VM firewall adds (x-one-run); everything is scoped to that run's business. Writes are tagged
 * "automation", so they don't trigger more automations (no loops).
 */
export const maxDuration = 30;

const str = (v: unknown) => {
  if (typeof v !== "string" || !v || v.length > 200) throw new Error("Invalid argument");
  return v;
};
const obj = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid data");
  return v as Record<string, unknown>;
};
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }) => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });

export async function POST(req: Request) {
  const token = req.headers.get("x-one-run");
  if (!token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const admin = createAdminClient();
  const businessId = await businessForRunToken(admin, token);
  if (!businessId) return NextResponse.json({ error: "This run has ended" }, { status: 401 });
  try {
    const { method, args } = (await req.json()) as { method?: string; args?: unknown[] };
    const a = Array.isArray(args) ? args : [];
    let value: unknown;
    switch (method) {
      case "records.list": {
        const r = await listRecords(admin, businessId, RecordQuery.parse(a[0]));
        value = { records: r.records.map(view), total: r.total };
        break;
      }
      case "records.get":
        value = view(await getRecord(admin, businessId, str(a[0]), str(a[1])));
        break;
      case "records.create":
        value = view(await createRecord(admin, businessId, str(a[0]), obj(a[1])));
        break;
      case "records.update":
        value = view(await updateRecord(admin, businessId, str(a[0]), str(a[1]), obj(a[2])));
        break;
      default:
        return NextResponse.json({ error: "Not allowed" }, { status: 400 });
    }
    return NextResponse.json({ value });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "Failed" }, { status: 400 });
  }
}
