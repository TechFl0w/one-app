import Link from "next/link";
import { ChevronRight, FileSpreadsheet, LogOut, Settings } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { usageThisMonth } from "@/server/ownerChat";
import { AI_MODELS, aiModelInfo, resolveAiModel } from "@/agent/models";
import { signOut } from "@/app/login/actions";
import { AccountForms, AiModelForm, BusinessForm } from "@/components/settings/SettingsForms";
import { changeEmail, changePassword, saveAiModel, saveBusiness, saveProfile } from "../settings-actions";

/** Settings: your account, the business, and everything it's connected to. */
export default async function SettingsPage({ params }: PageProps<"/b/[businessId]/settings">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { data: role } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", user?.id ?? "").maybeSingle();
  const manager = role && ["owner", "admin"].includes(role.role);
  const usage = manager ? await usageThisMonth(supabase, businessId) : null;
  const { data: biz } = manager ? await supabase.from("businesses").select("ai_model").eq("id", businessId).maybeSingle() : { data: null };
  const model = resolveAiModel(biz?.ai_model);
  const base = `/b/${businessId}`;


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

      {usage && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Assistant</h2>
          <div className="card space-y-6 p-6">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <p><span className="text-2xl font-bold tabular-nums">${usage.cost.toFixed(2)}</span> <span className="text-sm text-muted">used this month (estimate)</span></p>
              <p className="text-sm text-muted">{usage.turns} assistant {usage.turns === 1 ? "reply" : "replies"} · {aiModelInfo(model).label}</p>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium">Model — a smarter model costs more per message</p>
              <AiModelForm current={model} models={AI_MODELS.map((m, i) => ({ id: m.id, label: m.label, hint: m.hint, cost: "$".repeat(i + 1) }))} save={saveAiModel.bind(null, businessId)} />
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Data</h2>
        <Link href={`${base}/import`} className="card flex items-center gap-4 px-6 py-4 hover:bg-ground">
          <FileSpreadsheet className="h-5 w-5 text-accent" />
          <span className="flex-1"><span className="block font-medium">Import a spreadsheet</span><span className="block text-sm text-muted">Bring in clients, products, anything</span></span>
          <ChevronRight className="h-4 w-4 text-muted" />
        </Link>
      </section>

      <form action={signOut}>
        <button className="btn-ghost"><LogOut className="h-4 w-4" /> Sign out</button>
      </form>
    </div>
  );
}
