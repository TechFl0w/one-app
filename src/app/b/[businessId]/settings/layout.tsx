import { getBusinessContext } from "@/server/context";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

/** Every settings page shares the tab menu across the top. */
export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { blueprint } = await getBusinessContext(businessId);
  const base = `/b/${businessId}/settings`;
  const tabs = [
    { href: base, label: "General" },
    { href: `${base}/integrations`, label: "Integrations" },
    { href: `${base}/payments`, label: "Payments" },
    ...(blueprint.scheduling ? [{ href: `${base}/booking`, label: "Online booking" }] : []),
    { href: `${base}/website`, label: "Website" },
    { href: `${base}/email`, label: "Email" },
    { href: `${base}/whatsapp`, label: "WhatsApp & texts" },
    { href: `${base}/connections`, label: "AI apps" },
    { href: `${base}/code`, label: "API & code" },
  ];
  return (
    <div>
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
