import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Bot, CalendarDays, CreditCard, FileSpreadsheet, Globe, Mail, MessageCircle, MessageSquare, Plug } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccount, stripeConfigured } from "@/server/payments";
import { getLine, whatsappConfigured } from "@/server/whatsapp";
import { resendClient } from "@/server/email";
import { ensureFeed, feedUrl, resetFeed } from "@/server/calendarFeeds";
import { listConnections, removeConnection, syncUpcoming } from "@/server/googleCalendar";
import { redirect } from "next/navigation";
import { googleConfigured } from "@/integrations/googleCalendar";
import { CalendarFeedRow } from "@/components/settings/CalendarFeedRow";
import { IntegrationCatalog, type CatalogItem } from "@/components/settings/IntegrationCatalog";
import { recordLabel } from "@/engine/blockData";
import type { Blueprint } from "@/schema/blueprint";

type Health = "on" | "off" | "attention" | "soon";
const PILL: Record<Health, [string, string]> = {
  on: ["Connected", "bg-accent-tint text-accent"],
  off: ["Not connected", "bg-ground text-muted"],
  attention: ["Needs attention", "bg-amber-50 text-amber-900"],
  soon: ["Coming soon", "bg-ground text-muted"],
};

/** What in the setup uses a channel, in plain words. */
function usedBy(bp: Blueprint, channel: "email" | "whatsapp" | "sms"): string[] {
  return bp.automations.filter((a) => a.enabled && a.actions.some((x) => x.type === "send_message" && (x.channel === channel || (x.channel === "auto" && channel !== "sms")))).map((a) => a.label);
}

/**
 * Every outside service the business is connected to, how it's doing, and what uses it — in
 * one place. Each card links to its own settings; the calendar feed lives here.
 */
export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const googleMsg = (await searchParams).google;
  const { supabase, blueprint: bp } = await getBusinessContext(businessId);
  const base = `/b/${businessId}`;
  const admin = createAdminClient();
  const [account, line, tokens] = await Promise.all([
    getAccount(supabase, businessId).catch(() => null),
    getLine(supabase, businessId).catch(() => null),
    supabase.from("api_tokens").select("id", { count: "exact", head: true }).eq("business_id", businessId).is("revoked_at", null),
  ]);
  const sc = bp.scheduling;
  const people = sc ? (await admin.from("records").select("id, data").eq("business_id", businessId).eq("table_id", sc.practitioners.table).limit(50)).data ?? [] : [];
  const pTable = sc ? bp.tables.find((t) => t.id === sc.practitioners.table) : undefined;
  const feeds = sc
    ? await Promise.all([
        ensureFeed(admin, businessId, null).then((t) => ({ id: null as string | null, name: "Everyone", url: feedUrl(t) })),
        ...people.map((p) => ensureFeed(admin, businessId, p.id as string).then((t) => ({ id: p.id as string, name: pTable ? recordLabel(pTable, { id: p.id, data: p.data } as never) : "Staff", url: feedUrl(t) }))),
      ]).catch(() => [])
    : [];
  const invoices = bp.documents?.some((d) => d.kind === "invoice");
  const deposits = !!sc?.deposit;
  const google = googleConfigured();
  const googleConns = google ? await listConnections(admin, businessId) : [];
  const googleFor = (personId: string | null) => googleConns.find((c) => c.personId === personId);
  const connectHref = (personId: string | null) => `/api/integrations/google/start?business=${businessId}${personId ? `&person=${personId}` : ""}`;

  async function syncGoogleNow() {
    "use server";
    const { supabase: db, blueprint: current } = await getBusinessContext(businessId);
    const { data: claims } = await db.auth.getClaims();
    const { data: m } = await db.from("memberships").select("role").eq("business_id", businessId).eq("user_id", (claims?.claims.sub as string) ?? "").maybeSingle();
    if (!m || !["owner", "admin"].includes(m.role)) return;
    const r = await syncUpcoming(createAdminClient(), current, businessId);
    const msg = r.errors.length ? `sync_error:${r.errors[0]}` : `synced:${r.bookings}`;
    redirect(`${base}/settings/integrations?google=${encodeURIComponent(msg)}#calendar`);
  }

  async function disconnectGoogle(personId: string | null) {
    "use server";
    const { supabase: db } = await getBusinessContext(businessId);
    const { data: claims } = await db.auth.getClaims();
    const { data: m } = await db.from("memberships").select("role").eq("business_id", businessId).eq("user_id", (claims?.claims.sub as string) ?? "").maybeSingle();
    if (!m || !["owner", "admin"].includes(m.role)) return;
    await removeConnection(createAdminClient(), businessId, personId);
    revalidatePath(`${base}/settings/integrations`);
  }

  async function reset(personId: string | null) {
    "use server";
    const { supabase: db } = await getBusinessContext(businessId);
    const { data: claims } = await db.auth.getClaims();
    const { data: m } = await db.from("memberships").select("role").eq("business_id", businessId).eq("user_id", (claims?.claims.sub as string) ?? "").maybeSingle();
    if (!m || !["owner", "admin"].includes(m.role)) return;
    await resetFeed(createAdminClient(), businessId, personId);
    revalidatePath(`${base}/settings/integrations`);
  }

  async function requestIntegration(id: string) {
    "use server";
    if (!/^[a-z0-9_]{2,40}$/.test(id)) return;
    const { supabase: db, userId } = await getBusinessContext(businessId);
    await db.from("integration_requests").upsert({ business_id: businessId, integration: id, requested_by: userId ?? null }, { onConflict: "business_id,integration", ignoreDuplicates: true });
  }
  const { data: asked } = await supabase.from("integration_requests").select("integration").eq("business_id", businessId);
  const wanted = new Set((asked ?? []).map((r) => r.integration as string));
  const catalog: CatalogItem[] = [
    { id: "stripe", name: "Stripe", category: "Payments", text: "Card payments for invoices, deposits and payment links.", href: `${base}/settings/payments` },
    { id: "square", name: "Square", category: "Payments", text: "Take payments and bring in your Square bookings and clients." },
    { id: "google_calendar", name: "Google Calendar", category: "Calendar", text: "Two-way: bookings in your calendar, your own events block booking times.", ...(google ? { href: "#calendar" } : {}) },
    { id: "outlook_calendar", name: "Outlook Calendar", category: "Calendar", text: "Two-way sync with Outlook and Microsoft 365." },
    { id: "calendar_feed", name: "Apple / any calendar", category: "Calendar", text: "Subscribe to your bookings from any calendar app.", href: "#calendar" },
    { id: "whatsapp", name: "WhatsApp", category: "Messages", text: "Reminders, confirmations and replies on your business number.", href: `${base}/settings/whatsapp` },
    { id: "sms", name: "Text messages (SMS)", category: "Messages", text: "Texts from your business number.", href: `${base}/settings/whatsapp` },
    { id: "email", name: "Email", category: "Messages", text: "Confirmations and reminders by email; replies come to you.", href: `${base}/settings/email` },
    { id: "email_domain", name: "Your own email domain", category: "Messages", text: "Send as bookings@yourbusiness.com." },
    { id: "quickbooks", name: "QuickBooks", category: "Accounting", text: "Invoices, payments and clients sent to QuickBooks Online." },
    { id: "xero", name: "Xero", category: "Accounting", text: "Invoices, payments and clients sent to Xero." },
    { id: "accounting_csv", name: "Spreadsheet export", category: "Accounting", text: "Sent invoices as a spreadsheet for your accountant.", ...(invoices ? { href: "#accounting" } : {}) },
    { id: "google_business", name: "Google Business Profile", category: "Marketing", text: "A Book button on Google Maps and Search, and review requests." },
    { id: "instagram", name: "Instagram & Facebook", category: "Marketing", text: "Book from your profile; messages in your inbox." },
    { id: "mailchimp", name: "Mailchimp", category: "Marketing", text: "Keep your mailing list in step with your clients." },
    { id: "zapier", name: "Zapier / Make", category: "Automation", text: "Connect thousands of other apps with no code." },
    { id: "webhooks", name: "API & webhooks", category: "Automation", text: "Your own code and services, with API keys.", href: `${base}/settings/code` },
    { id: "ai_apps", name: "Claude, ChatGPT…", category: "Automation", text: "Run your business from your AI app.", href: `${base}/settings/connections` },
    { id: "google_drive", name: "Google Drive / Dropbox", category: "Files", text: "Save documents and photos to your own drive." },
  ].map((c) => ({ ...c, requested: wanted.has(c.id) }));

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const cards: { icon: typeof Plug; title: string; health: Health; text: string; uses?: string[]; href?: string; action?: string }[] = [
    {
      icon: CreditCard,
      title: "Stripe — get paid online",
      health: !stripeConfigured() ? "soon" : account?.chargesEnabled ? "on" : account ? "attention" : "off",
      text: account?.chargesEnabled ? "Clients can pay invoices, deposits and payment links by card." : account ? "Finish setting up your Stripe account to take payments." : "Connect Stripe so clients can pay invoices and deposits by card.",
      uses: [...(invoices ? ["Invoices (Pay button on the client’s link)"] : []), ...(deposits ? ["Booking deposits"] : []), "Payment links"],
      href: `${base}/settings/payments`,
      action: account?.chargesEnabled ? "Manage" : "Connect",
    },
    {
      icon: Mail,
      title: "Email",
      health: resendClient() ? "on" : "attention",
      text: resendClient() ? `Messages go out as “${bp.business.name}”; replies come to you.` : "Email sending isn’t set up on this server yet.",
      uses: usedBy(bp, "email"),
      href: `${base}/settings/email`,
      action: "Settings",
    },
    {
      icon: MessageCircle,
      title: "WhatsApp",
      health: !whatsappConfigured() ? "soon" : line?.status === "online" ? "on" : line?.lastError ? "attention" : "off",
      text: line?.status === "online" ? `Your business number ${line.phone ?? ""} is live.` : "A WhatsApp number for your business: reminders, confirmations and replies.",
      uses: usedBy(bp, "whatsapp"),
      href: `${base}/settings/whatsapp`,
      action: line?.status === "online" ? "Manage" : "Set up",
    },
    {
      icon: MessageSquare,
      title: "Text messages (SMS)",
      health: whatsappConfigured() && line?.phone ? "on" : "soon",
      text: whatsappConfigured() && line?.phone ? `Texts go out from ${line.phone}.` : "Texts from your business number come with your WhatsApp number.",
      uses: usedBy(bp, "sms"),
      href: `${base}/settings/whatsapp`,
    },
    {
      icon: Globe,
      title: "Website",
      health: bp.site?.enabled ? "on" : "off",
      text: bp.site?.enabled ? "Your website is live, with booking and a contact form." : "A website made from your app, in one click.",
      href: `${base}/settings/website`,
      action: bp.site ? "Manage" : "Make it",
    },
    {
      icon: Bot,
      title: "AI apps (Claude, ChatGPT…)",
      health: (tokens.count ?? 0) > 0 ? "on" : "off",
      text: (tokens.count ?? 0) > 0 ? `${tokens.count} app${tokens.count === 1 ? "" : "s"} can use your business.` : "Use your business from Claude or ChatGPT.",
      href: `${base}/settings/connections`,
      action: "Manage",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-center gap-3">
        <Plug className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
      </div>
      <p className="mb-6 text-sm text-muted">Everything your business is connected to, whether it’s working, and what uses it — and everything you can connect.</p>
      <h2 className="mb-3 text-lg font-semibold">Your connections</h2>

      <div className="grid gap-3">
        {cards.map((c) => (
          <div key={c.title} className="card flex flex-wrap items-start gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-tint text-accent"><c.icon className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{c.title}</p>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[c.health][1]}`}>{PILL[c.health][0]}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted">{c.text}</p>
              {c.uses && c.uses.length > 0 && <p className="mt-1 text-xs text-muted">Used by: {c.uses.join(" · ")}</p>}
            </div>
            {c.href && c.action && <Link href={c.href} className="btn-ghost px-4 py-1.5 text-sm">{c.action}</Link>}
          </div>
        ))}

        <div id="calendar" className="card scroll-mt-24 p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-tint text-accent"><CalendarDays className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Your calendar (Google, Apple, Outlook)</p>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[sc ? "on" : "off"][1]}`}>{sc ? "Ready" : "No bookings yet"}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted">Subscribe once and bookings show up in your own calendar, kept up to date. Each person can have their own.</p>
            </div>
          </div>
          {google && sc && (
            <div className="mt-4 rounded-2xl bg-ground p-4">
              <p className="text-sm font-semibold">Google Calendar — two-way</p>
              <p className="mb-3 text-xs text-muted">Bookings appear in Google Calendar, and anything already in someone’s calendar blocks those times on the booking page.</p>
              {googleMsg === "connected" && <p className="mb-3 rounded-xl bg-accent-tint px-3 py-2 text-sm text-accent">Connected. New and changed bookings will show up in Google Calendar within a few minutes.</p>}
              {typeof googleMsg === "string" && googleMsg.startsWith("synced:") && <p className="mb-3 rounded-xl bg-accent-tint px-3 py-2 text-sm text-accent">Done — {googleMsg.slice(7)} upcoming {googleMsg.slice(7) === "1" ? "booking is" : "bookings are"} in Google Calendar now.</p>}
              {typeof googleMsg === "string" && googleMsg.startsWith("sync_error:") && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">Google said: {googleMsg.slice(11)}</p>}
              {typeof googleMsg === "string" && googleMsg !== "connected" && !googleMsg.startsWith("synced:") && !googleMsg.startsWith("sync_error:") && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{googleMsg === "cancelled" ? "Google wasn’t connected — you can try again any time." : googleMsg === "not_allowed" ? "Only owners and admins can connect calendars." : "Google couldn’t be connected. Try again, and make sure you tick the calendar boxes on Google’s screen."}</p>}
              <ul className="divide-y divide-line">
                {[{ id: null as string | null, name: "Business calendar (every booking)" }, ...feeds.filter((f) => f.id).map((f) => ({ id: f.id, name: f.name }))].map((p) => {
                  const c = googleFor(p.id);
                  return (
                    <li key={p.id ?? "biz"} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{p.name}</span>
                        {c && <span className={`block text-xs ${c.ok && !c.syncError ? "text-muted" : "text-red-700"}`}>{!c.ok ? c.error ?? "Needs connecting again" : c.syncError ? `Last try failed: ${c.syncError}` : `Connected${c.email ? ` as ${c.email}` : ""}${c.syncedAt ? ` · last synced ${new Date(c.syncedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: bp.business.timezone })}` : " · nothing synced yet"}`}</span>}
                      </span>
                      {!c || !c.ok ? (
                        <a className="btn-primary px-3 py-1.5 text-xs" href={connectHref(p.id)}>{c ? "Connect again" : "Connect Google"}</a>
                      ) : (
                        <form action={disconnectGoogle.bind(null, p.id)}><button className="btn-ghost px-3 py-1.5 text-xs">Disconnect</button></form>
                      )}
                    </li>
                  );
                })}
              </ul>
              {googleConns.some((c) => c.ok) && (
                <form action={syncGoogleNow} className="mt-3">
                  <button className="btn-ghost px-3 py-1.5 text-xs">Sync now</button>
                  <span className="ml-2 text-xs text-muted">Puts every upcoming booking in Google right away. New changes go by themselves within minutes.</span>
                </form>
              )}
            </div>
          )}
          {feeds.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-sm font-semibold">Subscribe from any calendar — one-way, read only</p>
              <ul className="divide-y divide-line">
                {feeds.map((f) => <CalendarFeedRow key={f.id ?? "all"} name={f.name} url={f.url} reset={reset.bind(null, f.id)} />)}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-muted">Keep these links private — anyone with one can see those bookings. “New link” stops the old one.</p>
        </div>

        {invoices && (
          <div id="accounting" className="card flex scroll-mt-24 flex-wrap items-start gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-tint text-accent"><FileSpreadsheet className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Accounting (QuickBooks, Xero, your accountant)</p>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL.soon[1]}`}>Direct sync coming</span>
              </div>
              <p className="mt-0.5 text-sm text-muted">Download last month’s sent invoices as a spreadsheet QuickBooks and Xero can import.</p>
            </div>
            <a className="btn-ghost px-4 py-1.5 text-sm" href={`${base}/settings/integrations/export?from=${iso(first)}&to=${iso(last)}`}>Download</a>
          </div>
        )}
      </div>

      <h2 className="mb-1 mt-10 text-lg font-semibold">All integrations</h2>
      <p className="mb-4 text-sm text-muted">Connect what’s ready. For the rest, tap “I want this” — we build the most-asked first.</p>
      <IntegrationCatalog items={catalog} request={requestIntegration} />
    </div>
  );
}