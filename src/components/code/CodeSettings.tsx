"use client";

import { useActionState, useState, useTransition } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import type { KeyState } from "@/app/b/[businessId]/code-actions";

export interface KeyRow { name: string; host: string; header: string }
export interface FnRow { id: string; label: string; hosts: string[]; webhookUrl: string | null }
export interface RunRow { id: string; function_id: string; trigger: string; status: string; error: string | null; logs: string[]; started_at: string }

export function CodeSettings({ available, keys, functions, runs, save, remove }: { available: boolean; keys: KeyRow[]; functions: FnRow[]; runs: RunRow[]; save: (prev: KeyState, form: FormData) => Promise<KeyState>; remove: (name: string) => Promise<void> }) {
  const [state, action, pending] = useActionState(save, {});
  const [prefix, setPrefix] = useState("Bearer ");
  const [busy, start] = useTransition();
  const when = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const fnLabel = (id: string) => functions.find((f) => f.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      {!available && <p className="card p-5 text-sm text-muted">Server code can’t run on this server yet. You can still save keys and ask the assistant to write integrations.</p>}

      <section className="card space-y-4 p-6">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-accent" /><h2 className="font-semibold">API keys</h2></div>
        <p className="text-sm text-muted">
          Keys for outside services (shipping, accounting, calendars…). They’re only ever added to requests going to their own host, by the sandbox — the code the assistant writes never sees them, and they can’t be read back here.
        </p>
        {keys.length > 0 && (
          <ul className="divide-y divide-line/70 rounded-2xl border border-line">
            {keys.map((k) => (
              <li key={k.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono font-semibold">{k.name}</span>
                <span className="flex-1 truncate text-muted">{k.host} · {k.header}</span>
                <button type="button" className="rounded-full p-1.5 text-muted hover:bg-ground hover:text-ink" disabled={busy} onClick={() => start(() => remove(k.name))} aria-label={`Remove ${k.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Name</span><input name="name" className="input font-mono uppercase" placeholder="SHIPPO" maxLength={40} required /></label>
          <label className="block"><span className="label">API host</span><input name="host" className="input" placeholder="api.goshippo.com" required /></label>
          <label className="block"><span className="label">Header</span><input name="header" className="input" defaultValue="Authorization" /></label>
          <div>
            <span className="label">Before the key</span>
            <input type="hidden" name="prefix" value={prefix} />
            <Select value={prefix} onChange={(v) => setPrefix(v as string)} ariaLabel="Before the key" options={[{ value: "Bearer ", label: "Bearer …" }, { value: "Token ", label: "Token …" }, { value: "ShippoToken ", label: "ShippoToken …" }, { value: "Basic ", label: "Basic …" }, { value: "none", label: "Nothing (key only)" }]} />
          </div>
          <label className="block sm:col-span-2"><span className="label">Key</span><input name="value" type="password" autoComplete="off" className="input font-mono" required /></label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save key"}</button>
            {state.message && <p className={`text-sm ${state.ok ? "text-accent" : "text-red-700"}`}>{state.message}</p>}
          </div>
        </form>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">Server code</h2>
        {functions.length === 0 ? (
          <p className="text-sm text-muted">None yet. Ask the assistant, e.g. “when an order is marked shipped, create a label in Shippo”.</p>
        ) : (
          <ul className="space-y-2">
            {functions.map((f) => (
              <li key={f.id} className="rounded-2xl border border-line px-4 py-3 text-sm">
                <p className="font-medium">{f.label}</p>
                <p className="text-muted">Can reach: {f.hosts.join(", ") || "only One App"}</p>
                {f.webhookUrl && (
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                    Webhook: <code className="truncate">{f.webhookUrl}</code>
                    <button type="button" className="rounded-full p-1 hover:bg-ground" onClick={() => void navigator.clipboard?.writeText(f.webhookUrl!)} aria-label="Copy webhook URL"><Copy className="h-3.5 w-3.5" /></button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {runs.length > 0 && (
        <section className="card space-y-3 p-6">
          <h2 className="font-semibold">Recent runs</h2>
          <ul className="divide-y divide-line/70 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${r.status === "ok" ? "bg-accent" : r.status === "error" ? "bg-red-600" : "bg-amber-500"}`} />
                  <span className="font-medium">{fnLabel(r.function_id)}</span>
                  <span className="text-muted">· {r.trigger} · {when(r.started_at)}</span>
                </div>
                {r.error && <p className="mt-1 text-red-700">{r.error}</p>}
                {r.logs.length > 0 && <pre className="mt-1 max-h-24 overflow-auto rounded-xl bg-ground px-3 py-2 text-xs">{r.logs.join("\n")}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
