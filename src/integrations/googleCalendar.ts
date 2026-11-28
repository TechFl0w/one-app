/**
 * Google Calendar, over plain HTTPS (no SDK): sign-in links, tokens, writing bookings as events
 * and reading busy times. Pure functions plus a small fetch wrapper, so it's testable.
 */

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** The consent screen link; `state` comes back to the callback unchanged. */
export function authUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google sends a refresh token even when the person connected before.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function tokenCall(body: Record<string, string>, fetcher: typeof fetch = fetch): Promise<Tokens> {
  const r = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...body }),
  });
  const json = (await r.json().catch(() => ({}))) as Tokens & { error?: string; error_description?: string };
  if (!r.ok) throw new GoogleError(json.error_description ?? json.error ?? `Google said ${r.status}`, json.error === "invalid_grant");
  return json;
}
export const exchangeCode = (code: string, redirectUri: string, fetcher?: typeof fetch) => tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }, fetcher);
export const refreshAccess = (refreshToken: string, fetcher?: typeof fetch) => tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" }, fetcher);

/** The Google account's email, from the sign-in's id token (no extra call). */
export function emailFromIdToken(idToken?: string): string | null {
  const part = idToken?.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

export class GoogleError extends Error {
  /** The person removed access (or the token expired for good): they need to connect again. */
  constructor(message: string, readonly revoked = false) {
    super(message);
  }
}

/**
 * A booking's event id in Google: made from the record id (Google allows a-v and 0-9), so the
 * same booking always maps to the same event — no lookup table, no duplicates.
 */
export const eventIdFor = (recordId: string) => `oneapp${recordId.replace(/-/g, "").toLowerCase()}`;

export interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
}

/** Google's own words for an error ("Calendar usage limits exceeded", "Insufficient permission"). */
async function googleMessage(r: Response): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return `${r.status} ${j?.error?.message ?? r.statusText}`.trim();
}

async function api(token: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const r = await fetcher(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (r.status === 401) throw new GoogleError("Google access expired", true);
  return r;
}

/** Writes (or rewrites) the booking's event. */
export async function upsertEvent(token: string, calendarId: string, recordId: string, e: CalendarEvent, fetcher?: typeof fetch): Promise<void> {
  const id = eventIdFor(recordId);
  const body = JSON.stringify({ id, summary: e.summary, description: e.description, location: e.location, start: { dateTime: e.start }, end: { dateTime: e.end }, status: "confirmed" });
  const cal = encodeURIComponent(calendarId);
  const put = await api(token, `/calendars/${cal}/events/${id}`, { method: "PUT", body }, fetcher);
  if (put.ok) return;
  if (put.status !== 404) throw new GoogleError(`Couldn’t update the event: ${await googleMessage(put)}`);
  const post = await api(token, `/calendars/${cal}/events`, { method: "POST", body }, fetcher);
  // 409: it exists (it was deleted, so it's cancelled) — bring it back with an update.
  if (post.status === 409) {
    const again = await api(token, `/calendars/${cal}/events/${id}`, { method: "PUT", body }, fetcher);
    if (again.ok) return;
    throw new GoogleError(`Couldn’t restore the event: ${await googleMessage(again)}`);
  }
  if (!post.ok) throw new GoogleError(`Couldn’t add the event: ${await googleMessage(post)}`);
}

/** Removes the booking's event (cancelled or deleted booking). Gone already is fine. */
export async function deleteEvent(token: string, calendarId: string, recordId: string, fetcher?: typeof fetch): Promise<void> {
  const r = await api(token, `/calendars/${encodeURIComponent(calendarId)}/events/${eventIdFor(recordId)}`, { method: "DELETE" }, fetcher);
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new GoogleError(`Couldn’t remove the event (${r.status})`);
}

/**
 * Busy times in the calendar between two instants, without the events One App wrote itself
 * (those are bookings, already counted).
 */
export async function busyTimes(token: string, calendarId: string, from: string, to: string, fetcher?: typeof fetch): Promise<{ start: number; end: number }[]> {
  const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", maxResults: "500", orderBy: "startTime" });
  const r = await api(token, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`, {}, fetcher);
  if (!r.ok) throw new GoogleError(`Couldn’t read the calendar (${r.status})`);
  const json = (await r.json()) as { items?: { id?: string; status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
  return (json.items ?? [])
    .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && !e.id?.startsWith("oneapp"))
    .map((e) => {
      // All-day events block the whole day (their dates are local; UTC midnight is close enough to block it).
      const s = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : "");
      const en = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : "");
      return { start: Date.parse(s), end: Date.parse(en) };
    })
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
}
