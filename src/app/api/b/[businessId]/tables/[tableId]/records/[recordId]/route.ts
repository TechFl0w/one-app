import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteRecord, getRecord, updateRecord } from "@/server/records";
import { errorResponse, readJson } from "@/server/http";

type Ctx = RouteContext<"/api/b/[businessId]/tables/[tableId]/records/[recordId]">;

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { businessId, tableId, recordId } = await ctx.params;
    const record = await getRecord(await createClient(), businessId, tableId, recordId);
    return NextResponse.json({ record });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Partial update: only the given fields change; `null` clears one. Price/amount changes need `?confirm=true` (else 428). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { businessId, tableId, recordId } = await ctx.params;
    const confirmed = request.nextUrl.searchParams.get("confirm") === "true";
    const record = await updateRecord(await createClient(), businessId, tableId, recordId, await readJson(request), { confirmed });
    return NextResponse.json({ record });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Risky: requires `?confirm=true`, otherwise 428. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    const { businessId, tableId, recordId } = await ctx.params;
    const confirmed = request.nextUrl.searchParams.get("confirm") === "true";
    await deleteRecord(await createClient(), businessId, tableId, recordId, { confirmed });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
