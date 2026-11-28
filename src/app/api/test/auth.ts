import { timingSafeEqual } from "node:crypto";

/** The test API needs TEST_API_TOKEN (Authorization: Bearer …); without it set, it doesn't exist. */
export function testAuth(req: Request): Response | null {
  const want = process.env.TEST_API_TOKEN;
  if (!want || want.length < 24) return new Response("Not found", { status: 404 });
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
