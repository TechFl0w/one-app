import Link from "next/link";
import { Inbox } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { ensureEmailSettings } from "@/server/email";
import { emailDomains, inboundAddress } from "@/email/compose";
import { InboxView, type InboxItem } from "@/components/inbox/InboxView";
import { WhatsAppInbox, type ConversationItem } from "@/components/inbox/WhatsAppInbox";
import { markInboxRead } from "../email-actions";
import { conversationMessages, markConversationRead, replyAction, setConversationMode } from "../whatsapp-actions";

function Tabs({ businessId, active, waUnread }: { businessId: string; active: "email" | "whatsapp"; waUnread: number }) {
  const cls = (on: boolean) => `rounded-full px-4 py-1.5 text-sm ${on ? "bg-accent text-white" : "text-muted hover:bg-white"}`;
  return (
    <nav className="mb-4 flex gap-2" aria-label="Inbox channels">
      <Link href={`/b/${businessId}/inbox`} className={cls(active === "email")} aria-current={active === "email" ? "page" : undefined}>Email</Link>
      <Link href={`/b/${businessId}/inbox?tab=whatsapp`} className={cls(active === "whatsapp")} aria-current={active === "whatsapp" ? "page" : undefined}>
        WhatsApp{waUnread > 0 ? ` (${waUnread})` : ""}
      </Link>
    </nav>
  );
}

export default async function InboxPage({ params, searchParams }: PageProps<"/b/[businessId]/inbox">) {
  const { businessId } = await params;
  const tab = (await searchParams).tab === "whatsapp" ? "whatsapp" : "email";
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, customer_phone, customer_name, mode, last_inbound_at, last_message_at, unread")
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const conversations = (convs ?? []) as ConversationItem[];
  const waUnread = conversations.reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);
  const tabs = <Tabs businessId={businessId} active={tab} waUnread={waUnread} />;

  if (tab === "whatsapp") {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-3">
          <Inbox className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        </div>
        {tabs}
        <p className="mb-6 text-sm text-muted">
          The assistant answers customers on WhatsApp and hands over anything it can’t handle. <Link className="text-accent hover:underline" href={`/b/${businessId}/settings/whatsapp`}>WhatsApp settings</Link>
        </p>
        <WhatsAppInbox
          items={conversations}
          timezone={blueprint.business.timezone}
          load={conversationMessages.bind(null, businessId)}
          reply={replyAction.bind(null, businessId)}
          setMode={setConversationMode.bind(null, businessId)}
          markRead={markConversationRead.bind(null, businessId)}
        />
      </div>
    );
  }

  const settings = await ensureEmailSettings(supabase, businessId, blueprint.business.name).catch(() => null);
  const { data } = await supabase
    .from("inbox_messages")
    .select("id, from_address, from_name, subject, text_body, received_at, read_at, forwarded_at")
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(100);
  return (
    <InboxView
      tabs={tabs}
      items={(data ?? []) as InboxItem[]}
      inboundAddress={settings ? inboundAddress(settings.slug, emailDomains()) : "your inbound address (owners only)"}
      timezone={blueprint.business.timezone}
      markRead={markInboxRead.bind(null, businessId)}
    />
  );
}
