"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import type { FormResult } from "@/app/b/[businessId]/settings-actions";

type Action = (prev: FormResult, form: FormData) => Promise<FormResult>;

function Status({ r }: { r: FormResult }) {
  return r.message ? <p className={`text-sm ${r.ok ? "text-accent" : "text-red-700"}`} role="status">{r.message}</p> : null;
}

/** Profile, email and password for the signed-in person. */
export function AccountForms({ name, email, saveProfile, changeEmail, changePassword }: { name: string; email: string; saveProfile: Action; changeEmail: Action; changePassword: Action }) {
  const [p, profileAction, p1] = useActionState(saveProfile, {});
  const [e, emailAction, p2] = useActionState(changeEmail, {});
  const [w, passwordAction, p3] = useActionState(changePassword, {});
  return (
    <div className="divide-y divide-line">
      <form action={profileAction} className="grid gap-3 py-6 first:pt-0 sm:grid-cols-[200px_1fr]">
        <div><p className="font-medium">Your name</p><p className="text-sm text-muted">Shown to your team.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <input name="name" defaultValue={name} className="input max-w-sm" maxLength={100} aria-label="Your name" />
          <button className="btn-ghost" disabled={p1}>Save</button>
          <Status r={p} />
        </div>
      </form>
      <form action={emailAction} className="grid gap-3 py-6 sm:grid-cols-[200px_1fr]">
        <div><p className="font-medium">Email</p><p className="text-sm text-muted">You sign in with this.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <input name="email" type="email" defaultValue={email} className="input max-w-sm" aria-label="Email" />
          <button className="btn-ghost" disabled={p2}>Change</button>
          <Status r={e} />
        </div>
      </form>
      <form action={passwordAction} className="grid gap-3 py-6 last:pb-0 sm:grid-cols-[200px_1fr]">
        <div><p className="font-medium">Password</p><p className="text-sm text-muted">At least 8 characters.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <input name="password" type="password" autoComplete="new-password" placeholder="New password" className="input max-w-[14rem]" aria-label="New password" />
          <input name="confirm" type="password" autoComplete="new-password" placeholder="Repeat it" className="input max-w-[14rem]" aria-label="Repeat new password" />
          <button className="btn-ghost" disabled={p3}>Change</button>
          <Status r={w} />
        </div>
      </form>
    </div>
  );
}

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "JPY", "MXN", "BRL", "ZAR", "SGD", "HKD", "INR"];

/** Business name, timezone, currency, review link. */
export function BusinessForm({ business, save }: { business: { name: string; timezone: string; currency?: string; reviewUrl?: string }; save: Action }) {
  const [r, action, pending] = useActionState(save, {});
  const [tz, setTz] = useState(business.timezone);
  const [cur, setCur] = useState(business.currency ?? "CAD");
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [business.timezone];
  const currencyName = (c: string) => {
    try {
      return new Intl.DisplayNames(undefined, { type: "currency" }).of(c) ?? c;
    } catch {
      return c;
    }
  };
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2">
      <label className="block sm:col-span-2"><span className="label">Business name</span><input name="name" defaultValue={business.name} className="input" maxLength={80} required /></label>
      <div>
        <span className="label">Timezone</span>
        <input type="hidden" name="timezone" value={tz} />
        <Select value={tz} onChange={(v) => setTz(v as string)} ariaLabel="Timezone" searchable options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
      </div>
      <div>
        <span className="label">Currency</span>
        <input type="hidden" name="currency" value={cur} />
        <Select value={cur} onChange={(v) => setCur(v as string)} ariaLabel="Currency" options={CURRENCIES.map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }))} />
      </div>
      <label className="block sm:col-span-2">
        <span className="label">Review link</span>
        <input name="reviewUrl" type="url" defaultValue={business.reviewUrl ?? ""} placeholder="https://g.page/r/…/review" className="input" />
        <span className="mt-1 block text-xs text-muted">Where review requests send happy customers.</span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Status r={r} />
      </div>
    </form>
  );
}
