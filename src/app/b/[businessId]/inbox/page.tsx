import { getBusinessContext } from "@/server/context";
import { ensureEmailSettings } from "@/server/email";
import { emailDomains, inboundAddress } from "@/email/compose";
import { InboxView, type InboxItem } from "@/components/inbox/InboxView";
import { markInboxRead } from "../email-actions";

export default async function InboxPage({ params }: PageProps<"/b/[businessId]/inbox">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const settings = await ensureEmailSettings(supabase, businessId, blueprint.business.name).catch(() => null);
  const { data } = await supabase
    .from("inbox_messages")
    .select("id, from_address, from_name, subject, text_body, received_at, read_at, forwarded_at")
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(100);
  return (
    <InboxView
      items={(data ?? []) as InboxItem[]}
      inboundAddress={settings ? inboundAddress(settings.slug, emailDomains()) : "your inbound address (owners only)"}
      timezone={blueprint.business.timezone}
      markRead={markInboxRead.bind(null, businessId)}
    />
  );
}
