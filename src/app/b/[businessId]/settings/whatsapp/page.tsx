import { MessageCircle } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { getLine, whatsappConfigured } from "@/server/whatsapp";
import { STARTER_TEMPLATES } from "@/whatsapp/core";
import { WhatsAppSettings } from "@/components/inbox/WhatsAppSettings";
import { buyNumberAction, connectSenderAction, findNumbers, refreshLineAction } from "../../whatsapp-actions";

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function WhatsAppSettingsPage({ params }: PageProps<"/b/[businessId]/settings/whatsapp">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const line = await getLine(supabase, businessId).catch(() => null);
  const { data: tpls } = await supabase.from("whatsapp_templates").select("template_key, status").eq("business_id", businessId);
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <MessageCircle className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
      </div>
      <WhatsAppSettings
        configured={whatsappConfigured()}
        meta={appId && configId ? { appId, configId, solutionId: process.env.NEXT_PUBLIC_META_SOLUTION_ID || undefined } : null}
        businessName={blueprint.business.name}
        line={line}
        templates={(tpls ?? []).map((t) => ({ key: t.template_key, status: t.status, name: pretty(STARTER_TEMPLATES[t.template_key]?.name ?? t.template_key) }))}
        find={findNumbers.bind(null, businessId)}
        buy={buyNumberAction.bind(null, businessId)}
        connect={connectSenderAction.bind(null, businessId)}
        refresh={refreshLineAction.bind(null, businessId)}
      />
    </div>
  );
}
