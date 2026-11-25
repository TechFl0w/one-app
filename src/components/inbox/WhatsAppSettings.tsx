"use client";

import { useState, useTransition } from "react";
import type { LineStatus } from "@/whatsapp/core";

type State = { ok?: boolean; message?: string };
type FoundNumber = { phone: string; label: string; locality: string | null; region: string | null };

declare global {
  interface Window {
    FB?: { init(o: object): void; login(cb: (r: unknown) => void, o: object): void };
    fbAsyncInit?: () => void;
  }
}

const STATUS: Record<LineStatus, string> = {
  none: "Not set up",
  number_ready: "Number ready — connect it to WhatsApp",
  registering: "Waiting for WhatsApp to approve your number",
  online: "WhatsApp is on",
  offline: "WhatsApp is offline",
  failed: "Setup failed",
};

/** Meta's Embedded Signup popup; resolves with the WhatsApp Business Account id. */
function embeddedSignup(appId: string, configId: string, solutionId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        window.removeEventListener("message", onMessage);
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") resolve(String(data.data?.waba_id));
        else reject(new Error(data.event === "CANCEL" ? "Signup was cancelled" : "Signup didn’t finish"));
      } catch {
        /* not ours */
      }
    };
    window.addEventListener("message", onMessage);
    const run = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v23.0" });
      window.FB!.login(() => {}, {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { sessionInfoVersion: "3", featureType: "only_waba_sharing", ...(solutionId ? { setup: { solutionID: solutionId } } : {}) },
      });
    };
    if (window.FB) return run();
    window.fbAsyncInit = run;
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Couldn’t load Facebook’s signup"));
    document.body.appendChild(s);
  });
}

export function WhatsAppSettings({
  configured,
  meta,
  businessName,
  line,
  templates,
  find,
  buy,
  connect,
  refresh,
}: {
  configured: boolean;
  meta: { appId: string; configId: string; solutionId?: string } | null;
  businessName: string;
  line: { phone: string | null; status: LineStatus; displayName: string | null; lastError: string | null } | null;
  templates: { key: string; name: string; status: string }[];
  find: (country: "CA" | "US", areaCode?: number) => Promise<FoundNumber[]>;
  buy: (phone: string) => Promise<State>;
  connect: (wabaId: string, displayName: string) => Promise<State>;
  refresh: () => Promise<State>;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState<"CA" | "US">("CA");
  const [area, setArea] = useState("");
  const [found, setFound] = useState<FoundNumber[] | null>(null);
  const [name, setName] = useState(line?.displayName ?? businessName);
  const [waba, setWaba] = useState("");
  const status: LineStatus = line?.status ?? "none";
  const run = (f: () => Promise<State | void>) => start(async () => {
    setError(null);
    try {
      const r = await f();
      if (r && r.ok === false) setError(r.message ?? "Something went wrong.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  });

  if (!configured)
    return <div className="card p-6 text-sm text-muted">WhatsApp isn’t enabled on this server yet. Until then, automations send email.</div>;

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-6">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${status === "online" ? "bg-accent" : status === "none" ? "bg-line" : status === "failed" || status === "offline" ? "bg-red-600" : "bg-amber-500"}`} />
          <p className="flex-1 text-sm font-semibold">{STATUS[status]}</p>
          {line?.phone && <span className="text-sm text-muted">{line.phone}</span>}
          {(status === "registering" || status === "online" || status === "offline") && (
            <button type="button" className="btn-ghost px-3 py-1.5" disabled={busy} onClick={() => run(refresh)}>{busy ? "Checking…" : "Check again"}</button>
          )}
        </div>
        <p className="text-sm text-muted">
          Customers message your own WhatsApp number. The assistant answers questions, books and cancels appointments, and hands anything else to you in the Inbox.
          Reminders and other automation messages go out on WhatsApp once your message templates are approved.
        </p>
        {line?.lastError && <p className="text-sm text-red-700">{line.lastError}</p>}
      </section>

      {status === "none" && (
        <section className="card space-y-4 p-6">
          <h2 className="font-semibold">1. Get a number</h2>
          <div className="flex flex-wrap gap-2">
            <select className="input w-auto" value={country} onChange={(e) => setCountry(e.target.value as "CA" | "US")} aria-label="Country">
              <option value="CA">Canada</option>
              <option value="US">United States</option>
            </select>
            <input className="input w-32" inputMode="numeric" placeholder="Area code" value={area} onChange={(e) => setArea(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="Area code" />
            <button type="button" className="btn-primary" disabled={busy} onClick={() => run(async () => setFound(await find(country, area ? Number(area) : undefined)))}>Find numbers</button>
          </div>
          {found && found.length === 0 && <p className="text-sm text-muted">No numbers there — try another area code.</p>}
          {found && found.length > 0 && (
            <ul className="divide-y divide-line/70 rounded-2xl border border-line">
              {found.map((n) => (
                <li key={n.phone} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="flex-1">{n.label} <span className="text-muted">{[n.locality, n.region].filter(Boolean).join(", ")}</span></span>
                  <button type="button" className="btn-ghost px-3 py-1" disabled={busy} onClick={() => run(() => buy(n.phone))}>Use this number</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(status === "number_ready" || status === "failed") && (
        <section className="card space-y-4 p-6">
          <h2 className="font-semibold">2. Connect it to WhatsApp</h2>
          <p className="text-sm text-muted">Sign in with Facebook to create your WhatsApp Business profile. WhatsApp sends a code to {line?.phone} — we receive it for you.</p>
          <label className="block">
            <span className="label">Name customers see</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          {meta ? (
            <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={() => run(async () => connect(await embeddedSignup(meta.appId, meta.configId, meta.solutionId), name))}>
              Continue with Facebook
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1" placeholder="WhatsApp Business Account id" value={waba} onChange={(e) => setWaba(e.target.value)} aria-label="WhatsApp Business Account id" />
              <button type="button" className="btn-primary" disabled={busy || !waba || !name.trim()} onClick={() => run(() => connect(waba, name))}>Connect</button>
            </div>
          )}
        </section>
      )}

      {status === "online" && (
        <section className="card space-y-3 p-6">
          <h2 className="font-semibold">Message templates</h2>
          <p className="text-sm text-muted">WhatsApp has to approve the messages you send first (reminders, review requests…). This usually takes minutes, sometimes a day.</p>
          {templates.length === 0 ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => run(refresh)}>Submit templates</button>
          ) : (
            <ul className="divide-y divide-line/70 rounded-2xl border border-line">
              {templates.map((t) => (
                <li key={t.key} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{t.name}</span>
                  <span className={t.status === "approved" ? "text-accent" : t.status === "rejected" ? "text-red-700" : "text-muted"}>{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
