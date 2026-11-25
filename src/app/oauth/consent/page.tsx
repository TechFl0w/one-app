import { redirect } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { decideAuthorization } from "./actions";

/** "Sign in to One App" for AI apps (Supabase Auth OAuth 2.1 server sends people here). */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const sp = await searchParams;
  const id = typeof sp.authorization_id === "string" ? sp.authorization_id : "";
  if (!id) return <Shell><p className="text-sm text-muted">This sign-in link is incomplete. Start again from your AI app.</p></Shell>;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Shell><p className="text-sm text-muted">This sign-in request has expired or was already used. Start again from your AI app.</p></Shell>;
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  const { data: memberships } = await supabase.from("memberships").select("role, businesses(name)").in("role", ["owner", "admin"]);
  const names = (memberships ?? []).map((m) => (m.businesses as unknown as { name: string } | null)?.name).filter(Boolean);
  const approve = decideAuthorization.bind(null, id, true);
  const deny = decideAuthorization.bind(null, id, false);
  const app = data.client.name || "An AI app";

  return (
    <Shell>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the AI app's registration */}
        {data.client.logo_uri ? <img src={data.client.logo_uri} alt="" className="h-10 w-10 rounded-xl" /> : <Bot className="h-10 w-10 text-accent" />}
        <h1 className="text-xl font-bold tracking-tight">{app} wants to use One App</h1>
      </div>
      <p className="text-sm text-muted">Signed in as <span className="font-medium text-ink">{data.user.email}</span>.</p>
      <ul className="space-y-2 text-sm">
        <li>• Look up and change your records, bookings and setup{names.length ? ` in ${names.join(", ")}` : ""}.</li>
        <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Deleting, refunds, price and automation changes always wait for your approval in One App.</li>
        <li>• You can disconnect it any time.</li>
      </ul>
      {typeof sp.error === "string" && <p className="text-sm text-red-700">{sp.error}</p>}
      <div className="flex gap-2">
        <form action={approve}><button className="btn-primary">Allow</button></form>
        <form action={deny}><button className="btn-ghost">Cancel</button></form>
      </div>
      <p className="text-xs text-muted">Only allow apps you trust. It will act as you.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4 p-8">{children}</div>
    </main>
  );
}
