import "server-only";
import { NextResponse } from "next/server";
import { ChangeSetError } from "@/engine/changeSet";
import { RecordError } from "@/engine/records";

const STATUS: Record<string, number> = { invalid: 422, not_found: 404, conflict: 409, needs_confirmation: 428 };

/** Maps domain errors to JSON responses; anything else is a 500 without internals. */
export function errorResponse(e: unknown) {
  if (e instanceof RecordError || e instanceof ChangeSetError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, ...(e instanceof RecordError && e.fieldErrors.length ? { fields: e.fieldErrors } : {}) } },
      { status: STATUS[e.code] ?? 400 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RecordError("invalid", "Body must be JSON");
  }
}
