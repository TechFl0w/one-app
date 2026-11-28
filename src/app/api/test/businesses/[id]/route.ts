import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTestBusiness } from "@/server/testAccounts";
import { testAuth } from "../../auth";

/** DELETE: removes a test business and everything in it (real businesses are refused). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = testAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const ok = await deleteTestBusiness(createAdminClient(), id).catch(() => false);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "not a test business" }, { status: 404 });
}
