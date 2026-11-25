import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRecord, listRecords } from "@/server/records";
import { errorResponse, readJson } from "@/server/http";
import { RecordError } from "@/engine/records";

type Ctx = RouteContext<"/api/b/[businessId]/tables/[tableId]/records">;

/**
 * GET  ?filters=[{"field","op","value"}]&sort=[{"field","dir"}]&limit=50&offset=0
 * POST { "fld_x": value, ... }
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const { businessId, tableId } = await ctx.params;
    const sp = request.nextUrl.searchParams;
    const json = (key: string) => {
      const v = sp.get(key);
      if (!v) return undefined;
      try {
        return JSON.parse(v);
      } catch {
        throw new RecordError("invalid", `${key} must be JSON`);
      }
    };
    const num = (key: string) => (sp.has(key) ? Number(sp.get(key)) : undefined);
    const supabase = await createClient();
    const result = await listRecords(supabase, businessId, {
      table: tableId,
      filters: json("filters"),
      sort: json("sort"),
      limit: num("limit"),
      offset: num("offset"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { businessId, tableId } = await ctx.params;
    const supabase = await createClient();
    const record = await createRecord(supabase, businessId, tableId, await readJson(request));
    return NextResponse.json({ record }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
