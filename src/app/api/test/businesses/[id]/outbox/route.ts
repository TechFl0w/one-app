import { createAdminClient } from "@/lib/supabase/admin";
import { outbox } from "@/server/testAccounts";
import { isTestBusiness } from "@/server/testMode";
import { testAuth } from "../../../auth";

/** GET: the emails and texts this test business would have sent. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = testAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const admin = createAdminClient();
  if (!(await isTestBusiness(admin, id))) return Response.json({ error: "not a test business" }, { status: 404 });
  return Response.json({ messages: await outbox(admin, id) });
}
