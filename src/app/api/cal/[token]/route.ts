import { feedFor } from "@/server/calendarFeeds";

/** A private calendar feed: /api/cal/<token>.ics (Google, Apple and Outlook subscribe to it). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await feedFor(token.replace(/\.ics$/, "")).catch(() => null);
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" } });
}
