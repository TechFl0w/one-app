"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";

export interface TokenRow {
  id: string;
  name: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
}

/** Connect AI apps (Claude and other MCP clients) to this business with a personal token. */
export function Connections({
  url,
  tokens,
  create,
  revoke,
}: {
  url: string;
  tokens: TokenRow[];
  create: (name: string) => Promise<{ token?: string; message?: string }>;
  revoke: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)) : "never");
  const copy = (s: string) => void navigator.clipboard?.writeText(s);

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-6">
        <p className="text-sm text-muted">
          Use your business from Claude or another AI app that supports MCP. It gets the same tools as the assistant in One App: look up and change records,
          bookings and setup. Deleting, refunds, price and automation changes always wait for you under <span className="font-medium text-ink">Approvals</span>.
        </p>
        <div>
          <span className="label">Server URL</span>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-xs" readOnly value={url} aria-label="Server URL" />
            <button type="button" className="btn-ghost px-3" onClick={() => copy(url)} aria-label="Copy URL"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">New connection</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await create(name); if (r.token) { setFresh(r.token); setName(""); setError(null); } else setError(r.message ?? "Couldn’t create it."); }); }}>
          <input className="input flex-1" placeholder="Name, e.g. Claude on my laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Connection name" />
          <button className="btn-primary" disabled={busy || !name.trim()}>Create token</button>
        </form>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {fresh && (
          <div className="space-y-2 rounded-2xl bg-accent-tint p-4">
            <p className="text-sm font-semibold">Copy this token now — it won’t be shown again.</p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" readOnly value={fresh} aria-label="New token" />
              <button type="button" className="btn-ghost px-3" onClick={() => copy(fresh)} aria-label="Copy token"><Copy className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted">In your AI app, add a remote MCP server with the URL above and the header <code>Authorization: Bearer &lt;token&gt;</code>.</p>
          </div>
        )}
      </section>

      {tokens.length > 0 && (
        <section className="card p-2">
          <ul className="divide-y divide-line/70">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted">{t.hint} · created {day(t.created_at)} · last used {day(t.last_used_at)}</p>
                </div>
                <button type="button" className="btn-ghost px-3 py-1" disabled={busy} onClick={() => start(() => revoke(t.id))}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
