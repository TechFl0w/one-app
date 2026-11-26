"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, Printer } from "lucide-react";
import { decideDocument, payDocument } from "./actions";

/** Accept / decline a quote with your name, or pay an invoice — and print either. */
export function CustomerActions({ token, canAccept, canPay, kind, amount }: { token: string; canAccept: boolean; canPay: boolean; kind: "quote" | "invoice"; amount: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const decide = (d: "accept" | "decline") =>
    start(async () => {
      setError(null);
      const r = await decideDocument(token, d, name);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  return (
    <div className="no-print space-y-3">
      {canAccept && (
        <div className="card p-5">
          <p className="font-bold">Happy with this {kind}?</p>
          <p className="mt-1 text-sm text-muted">Type your name to accept it. {amount} — we’ll be in touch to schedule the work.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input min-w-0 flex-[1_1_12rem]" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your full name" autoComplete="name" />
            <button type="button" className="btn-primary" disabled={pending || name.trim().length < 2} onClick={() => decide("accept")}>
              <Check className="h-4 w-4" /> Accept {kind}
            </button>
          </div>
          {!declining ? (
            <button type="button" className="mt-3 text-sm text-muted underline" onClick={() => setDeclining(true)}>
              Decline instead
            </button>
          ) : (
            <p className="mt-3 text-sm">
              Decline this {kind}?{" "}
              <button type="button" className="font-semibold text-red-700 underline" disabled={pending} onClick={() => decide("decline")}>
                Yes, decline
              </button>{" "}
              <button type="button" className="text-muted underline" onClick={() => setDeclining(false)}>
                Keep it
              </button>
            </p>
          )}
        </div>
      )}
      {canPay && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-bold">Pay {amount} online</p>
            <p className="text-sm text-muted">Card or wallet, secured by Stripe.</p>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await payDocument(token);
                if (!r.ok) return setError(r.error);
                window.location.href = r.url;
              })
            }
          >
            <CreditCard className="h-4 w-4" /> Pay now
          </button>
        </div>
      )}
      {error && <p role="alert" className="rounded-2xl bg-[#FDE7E5] px-4 py-3 text-sm text-[#B42318]">{error}</p>}
      <button type="button" className="btn-ghost" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print or save as PDF
      </button>
    </div>
  );
}
