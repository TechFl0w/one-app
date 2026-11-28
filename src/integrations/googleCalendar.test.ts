import { describe, expect, it } from "vitest";
import { authUrl, busyTimes, emailFromIdToken, eventIdFor, upsertEvent } from "./googleCalendar";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("google calendar", () => {
  it("asks for offline calendar access", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    const u = new URL(authUrl("https://app/cb", "st"));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("scope")).toContain("calendar.events");
    expect(u.searchParams.get("state")).toBe("st");
  });
  it("event ids come from the record id, in Google's alphabet", () => {
    const id = eventIdFor("6f9619ff-8b86-d011-b42d-00cf4fc964ff");
    expect(id).toBe("oneapp6f9619ff8b86d011b42d00cf4fc964ff");
    expect(/^[a-v0-9]{5,1024}$/.test(id)).toBe(true);
  });
  it("reads the email from the id token", () => {
    const payload = Buffer.from(JSON.stringify({ email: "owner@example.com" })).toString("base64url");
    expect(emailFromIdToken(`x.${payload}.y`)).toBe("owner@example.com");
    expect(emailFromIdToken(undefined)).toBeNull();
  });
  it("updates the event, or adds it when it isn't there yet", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace("https://www.googleapis.com/calendar/v3", "")}`);
      return init?.method === "PUT" ? json(404, {}) : json(200, {});
    }) as typeof fetch;
    await upsertEvent("t", "primary", "6f9619ff-8b86-d011-b42d-00cf4fc964ff", { summary: "Groom — Biscuit", start: "2026-12-01T17:00:00Z", end: "2026-12-01T18:30:00Z" }, fetcher);
    expect(calls).toEqual(["PUT /calendars/primary/events/oneapp6f9619ff8b86d011b42d00cf4fc964ff", "POST /calendars/primary/events"]);
  });
  it("busy times leave out free and own events", async () => {
    const fetcher = (async () => json(200, { items: [
      { id: "abc", start: { dateTime: "2026-12-01T17:00:00Z" }, end: { dateTime: "2026-12-01T18:00:00Z" } },
      { id: "free", transparency: "transparent", start: { dateTime: "2026-12-01T19:00:00Z" }, end: { dateTime: "2026-12-01T20:00:00Z" } },
      { id: "oneapp123", start: { dateTime: "2026-12-01T21:00:00Z" }, end: { dateTime: "2026-12-01T22:00:00Z" } },
      { id: "day", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } },
    ] })) as unknown as typeof fetch;
    const busy = await busyTimes("t", "primary", "2026-12-01T00:00:00Z", "2026-12-03T00:00:00Z", fetcher);
    expect(busy).toEqual([
      { start: Date.parse("2026-12-01T17:00:00Z"), end: Date.parse("2026-12-01T18:00:00Z") },
      { start: Date.parse("2026-12-02T00:00:00Z"), end: Date.parse("2026-12-03T00:00:00Z") },
    ]);
  });
});
