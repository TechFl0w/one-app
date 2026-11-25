import Link from "next/link";
import { CalendarCheck, ChevronRight, Code2, CreditCard, FileSpreadsheet, LogOut, Mail, MessageCircle, Plug, Settings } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { signOut } from "@/app/login/actions";
import { AccountForms, BusinessForm } from "@/components/settings/SettingsForms";
import { changeEmail, changePassword, saveBusiness, saveProfile } from "../settings-actions";

/** Settings: your account, the business, and everything it's connected to. */
export default async function SettingsPage({ params }: PageProps<"/b/[businessId]/settings">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { data: role } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", user?.id ?? "").maybeSingle();
  const manager = role && ["owner", "admin"].includes(role.role);
  const base = `/b/${businessId}`;
  const links = [
    { href: `${base}/settings/booking`, icon: CalendarCheck, label: "Online booking", hint: "Your booking page, hours and rules", show: !!blueprint.scheduling },
    { href: `${base}/settings/payments`, icon: CreditCard, label: "Payments", hint: "Stripe, deposits, payment links", show: true },
    { href: `${base}/settings/email`, icon: Mail, label: "Email", hint: "Sender name, replies, inbound address", show: true },
    { href: `${base}/settings/whatsapp`, icon: MessageCircle, label: "WhatsApp", hint: "Your number and message templates", show: true },
    { href: `${base}/settings/connections`, icon: Plug, label: "Connect AI apps", hint: "Use your business from Claude, ChatGPT…", show: true },
    { href: `${base}/settings/code`, icon: Code2, label: "API keys & code", hint: "Keys for outside services, server code, runs", show: true },
    { href: `${base}/import`, icon: FileSpreadsheet, label: "Import a spreadsheet", hint: "Bring in clients, products, anything", show: true },
  ].filter((l) => l.show);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Your account</h2>
        <div className="card p-6">
          <AccountForms name={(user?.user_metadata?.full_name as string | undefined) ?? ""} email={user?.email ?? ""} saveProfile={saveProfile} changeEmail={changeEmail} changePassword={changePassword} />
        </div>
      </section>

      {manager && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Business</h2>
          <div className="card p-6">
            <BusinessForm business={blueprint.business} save={saveBusiness.bind(null, businessId)} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Connections & tools</h2>
        <ul className="card divide-y divide-line">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex items-center gap-4 px-6 py-4 hover:bg-ground">
                <l.icon className="h-5 w-5 text-accent" />
                <span className="flex-1"><span className="block font-medium">{l.label}</span><span className="block text-sm text-muted">{l.hint}</span></span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <form action={signOut}>
        <button className="btn-ghost"><LogOut className="h-4 w-4" /> Sign out</button>
      </form>
    </div>
  );
}
