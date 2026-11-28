import { createAdminClient } from "@/lib/supabase/admin";
import { createTestBusiness } from "@/server/testAccounts";
import { testAuth } from "../auth";

/**
 * POST { template, name?, timezone?, answers? } → a fresh test business with sample data and an
 * MCP token: { businessId, name, token, mcpUrl, seeded }. Its messages are captured, not sent.
 */
export async function POST(req: Request) {
  const denied = testAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { template?: string; name?: string; timezone?: string; answers?: Record<string, unknown> };
  if (!body.template) return Response.json({ error: "template is required (appointments, contractor, mechanic, chair_rental, maker_shop)" }, { status: 400 });
  try {
    return Response.json(await createTestBusiness(createAdminClient("mcp"), { template: body.template, name: body.name, timezone: body.timezone, answers: body.answers as never }), { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
