import { timingSafeEqual } from "node:crypto";

/** The test API needs TEST_API_TOKEN (Authorization: Bearer …); without it set, it doesn't exist. */
export function testAuth(req: Request): Response | null {
  const want = process.env.TEST_API_TOKEN?.trim();
  // Says why it's off (never the token), so setting it up isn't guesswork.
  if (!want) return new Response("Not found", { status: 404, headers: { "x-test-api": "off: TEST_API_TOKEN isn't set on this deployment" } });
  if (want.length < 24) return new Response("Not found", { status: 404, headers: { "x-test-api": `off: TEST_API_TOKEN is ${want.length} characters, needs 24 or more` } });
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
