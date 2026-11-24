"use client";

import { useActionState, useState, useTransition } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import type { Scheduling } from "@/schema/blueprint";

type ConnectInstance = ReturnType<typeof loadConnectAndInitialize>;

/** Payments setup: Stripe's embedded onboarding, account status, and the deposit rule. */
export function PaymentsSettings({
  publishableKey,
  status,
  deposit,
  canHold,
  getSecret,
  refresh,
  saveDeposit,
}: {
  publishableKey: string | null;
  status: { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean };
  deposit: Scheduling["deposit"] | null;
  canHold: boolean;
  getSecret: () => Promise<string>;
  refresh: () => Promise<void>;
  saveDeposit: (prev: { message?: string; ok?: boolean }, form: FormData) => Promise<{ message?: string; ok?: boolean }>;
}) {
  const [connect, setConnect] = useState<ConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [saved, saveAction, saving] = useActionState(saveDeposit, {});
  const [kind, setKind] = useState<string>(deposit?.kind ?? "none");

  const start = () => {
    if (!publishableKey) return;
    setError(null);
    setConnect(
      loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => {
          try {
            return await getSecret();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn’t start Stripe onboarding");
            throw e;
          }
        },
        appearance: { variables: { colorPrimary: "#17694F", fontFamily: "Plus Jakarta Sans, sans-serif", borderRadius: "12px" } },
      }),
    );
  };

  const ready = status.chargesEnabled;
  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${ready ? "bg-accent" : status.connected ? "bg-amber-500" : "bg-line"}`} />
          <p className="flex-1 text-sm font-semibold">
            {ready ? "Payments are on" : status.connected ? "Almost there — Stripe needs a few more details" : "Not connected yet"}
          </p>
          {status.connected && (
            <button type="button" className="btn-ghost px-3 py-1.5" disabled={refreshing} onClick={() => startRefresh(refresh)}>
              {refreshing ? "Checking…" : "Check again"}
            </button>
          )}
        </div>
        <p className="text-sm text-muted">
          Take deposits, send payment links and charge rent automatically. Money goes straight to your own Stripe account
          {status.payoutsEnabled ? " and is paid out to your bank." : "."} Already use Stripe? You can sign in during setup.
        </p>
        {!publishableKey ? (
          <p className="rounded-xl bg-ground px-4 py-3 text-sm text-muted">Payments aren’t enabled on this server yet. Until then, take payment in person or send your own payment links.</p>
        ) : connect ? (
          <div className="rounded-2xl border border-line p-2">
            <ConnectComponentsProvider connectInstance={connect}>
              <ConnectAccountOnboarding onExit={() => startRefresh(async () => { await refresh(); setConnect(null); })} />
            </ConnectComponentsProvider>
          </div>
        ) : (
          !ready && (
            <button type="button" className="btn-primary" onClick={start}>
              {status.connected ? "Continue Stripe setup" : "Connect Stripe"}
            </button>
          )
        )}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </section>

      <form action={saveAction} className="card space-y-4 p-6">
        <h2 className="font-semibold">Deposits for online bookings</h2>
        {!canHold && <p className="text-sm text-muted">Your booking setup has no “awaiting deposit” status yet — ask the assistant to add one before turning deposits on.</p>}
        <fieldset className="space-y-2 text-sm">
          {[["none", "No deposit"], ["percent", "A percentage of the price"], ["fixed", "A fixed amount"]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="accent-[var(--accent)]" disabled={v !== "none" && !canHold} />
              {l}
            </label>
          ))}
        </fieldset>
        {kind !== "none" && (
          <div className="max-w-40">
            <label className="label" htmlFor="value">{kind === "percent" ? "Percent" : "Amount"}</label>
            <input id="value" name="value" type="number" min="1" step={kind === "percent" ? "1" : "0.01"} max={kind === "percent" ? 100 : undefined} defaultValue={deposit?.value ?? (kind === "percent" ? 20 : 10)} className="input" required />
          </div>
        )}
        <p className="text-xs text-muted">Customers pay on Stripe right after picking a time; the time is held for 30 minutes meanwhile. {ready ? "" : "Deposits start once payments are on."}</p>
        {saved.message && <p className={`text-sm ${saved.ok ? "text-accent" : "text-red-700"}`} role="status">{saved.message}</p>}
        <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </form>
    </div>
  );
}
