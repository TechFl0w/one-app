import Link from "next/link";
import { History, Inbox, Settings, ShieldCheck, Zap } from "lucide-react";
import QRCode from "qrcode";
import { AppShell } from "@/components/shell/AppShell";
import { ShareBooking } from "@/components/booking/ShareBooking";
import { ensureBookingPage } from "@/server/bookingPage";
import { forBrowser } from "@/server/clientBlueprint";
import { getBusinessContext } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { withComputed } from "@/engine/computed";
import { menuCounts } from "@/engine/menuCounts";
import { loadConversation } from "@/server/ownerChat";
import { sandboxComponent, sandboxCreate, sandboxGet, sandboxList, sandboxFileUrl, sandboxSendDocument, sandboxDocumentLink, sandboxInvoiceFromQuote, sandboxFreeTimes, sandboxBookTime, sandboxRemove, sandboxUpdate, sandboxUploadTarget } from "./sandbox-actions";

// The assistant's server actions run here: rebuilding pages from a design can take a few minutes.
export const maxDuration = 300;

export default async function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const { blueprint, businesses, supabase, userId } = await getBusinessContext(businessId);
  const { count } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("read_at", null);
  const { count: waCount } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gt("unread", 0);
  const unread = (count ?? 0) + (waCount ?? 0);
  const { count: approvals } = await supabase
    .from("agent_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("origin", "mcp")
    .eq("status", "pending");
  // A broken count never takes the app down.
  const counts = await menuCounts(blueprint, withComputed(supabaseStore(supabase, businessId), blueprint)).catch(() => ({}));
  // Every business that takes online bookings has a public booking page (made on first visit).
  const booking = blueprint.scheduling ? await ensureBookingPage(supabase, businessId, blueprint.business.name).catch(() => null) : null;
  const bookingUrl = booking?.enabled ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/book/${booking.slug}` : null;
  const qrSvg = bookingUrl ? await QRCode.toString(bookingUrl, { type: "svg", margin: 1, color: { dark: "#1f1b14", light: "#ffffff" } }) : "";
  const { transcript } = userId ? await loadConversation(supabase, businessId, userId).catch(() => ({ transcript: [] })) : { transcript: [] };
  return (
    <AppShell
      sandbox={{
        list: sandboxList.bind(null, businessId),
        get: sandboxGet.bind(null, businessId),
        create: sandboxCreate.bind(null, businessId),
        update: sandboxUpdate.bind(null, businessId),
        remove: sandboxRemove.bind(null, businessId),
        uploadTarget: sandboxUploadTarget.bind(null, businessId),
        fileUrl: sandboxFileUrl.bind(null, businessId),
        sendDocument: sandboxSendDocument.bind(null, businessId),
        documentLink: sandboxDocumentLink.bind(null, businessId),
        invoiceFromQuote: sandboxInvoiceFromQuote.bind(null, businessId),
        freeTimes: sandboxFreeTimes.bind(null, businessId),
        bookTime: sandboxBookTime.bind(null, businessId),
        loadComponent: sandboxComponent.bind(null, businessId),
      }}
      blueprint={forBrowser(blueprint)}
      mode={{ kind: "server", businessId }}
      counts={counts}
      basePath={`/b/${businessId}`}
      businesses={businesses}
      transcript={transcript}
      footer={
        <div className="space-y-2">
          <Link href={`/b/${businessId}/inbox`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Inbox className="h-4 w-4" /> Inbox
            {unread > 0 && <span className="ml-auto rounded-full bg-accent px-2 text-xs font-semibold text-white">{unread}</span>}
          </Link>
          {(approvals ?? 0) > 0 && (
            <Link href={`/b/${businessId}/approvals`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
              <ShieldCheck className="h-4 w-4" /> Approvals
              <span className="ml-auto rounded-full bg-accent px-2 text-xs font-semibold text-white">{approvals}</span>
            </Link>
          )}
          {bookingUrl && <ShareBooking url={bookingUrl} qrSvg={qrSvg} business={blueprint.business.name} />}
          <Link href={`/b/${businessId}/automations`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Zap className="h-4 w-4" /> Automations
          </Link>
          <Link href={`/b/${businessId}/activity`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <History className="h-4 w-4" /> Activity
          </Link>
          <Link href={`/b/${businessId}/settings`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
