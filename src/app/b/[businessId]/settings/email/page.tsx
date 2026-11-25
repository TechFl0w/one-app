import { Mail } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { ensureEmailSettings } from "@/server/email";
import { emailDomains, inboundAddress } from "@/email/compose";
import { EmailSettingsForm } from "@/components/inbox/EmailSettingsForm";
import { saveEmailSettingsAction, sendTestEmailAction } from "../../email-actions";

export default async function EmailSettingsPage({ params }: PageProps<"/b/[businessId]/settings/email">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const settings = await ensureEmailSettings(supabase, businessId, blueprint.business.name).catch(() => null);
  const d = emailDomains();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Mail className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Email</h1>
      </div>
      {settings ? (
        <EmailSettingsForm
          settings={settings}
          fromAddress={`hello@${d.send}`}
          inboundAddress={inboundAddress(settings.slug, d)}
          save={saveEmailSettingsAction.bind(null, businessId)}
          sendTest={sendTestEmailAction.bind(null, businessId)}
        />
      ) : (
        <div className="card p-10 text-center text-sm text-muted">Only owners and admins can change email settings.</div>
      )}
    </div>
  );
}
