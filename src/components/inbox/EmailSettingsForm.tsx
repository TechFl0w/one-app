"use client";

import { useActionState } from "react";
import type { EmailSettings } from "@/email/compose";

export type SettingsState = { ok?: boolean; message?: string };

export function EmailSettingsForm({
  settings,
  fromAddress,
  inboundAddress,
  save,
  sendTest,
}: {
  settings: EmailSettings;
  fromAddress: string;
  inboundAddress: string;
  save: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
  sendTest: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
}) {
  const [saved, saveAction, saving] = useActionState(save, {});
  const [tested, testAction, testing] = useActionState(sendTest, {});
  return (
    <div className="space-y-6">
      <section className="card space-y-2 p-6 text-sm">
        <p><span className="text-muted">Emails are sent from</span> <span className="font-medium">“{settings.fromName}” &lt;{fromAddress}&gt;</span></p>
        <p><span className="text-muted">Your inbound address is</span> <span className="font-medium">{inboundAddress}</span></p>
        <p className="text-xs text-muted">We never send from your own address. Customers see your business name; their replies go where you choose below.</p>
      </section>
      <form action={saveAction} className="card space-y-5 p-6">
        <div>
          <label className="label" htmlFor="from_name">Sender name</label>
          <input id="from_name" name="from_name" className="input" defaultValue={settings.fromName} maxLength={64} required />
        </div>
        <div>
          <label className="label" htmlFor="owner_email">Your email</label>
          <input id="owner_email" name="owner_email" type="email" className="input" defaultValue={settings.ownerEmail ?? ""} placeholder="you@gmail.com" />
        </div>
        <fieldset className="space-y-2">
          <legend className="label">When customers reply</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="reply_mode" value="inbound" defaultChecked={settings.replyMode === "inbound"} className="accent-[var(--accent)]" />
            Put replies in the app Inbox
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="reply_mode" value="owner" defaultChecked={settings.replyMode === "owner"} className="accent-[var(--accent)]" />
            Send replies straight to my email
          </label>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="forward_to_owner" defaultChecked={settings.forwardToOwner} className="h-4 w-4 accent-[var(--accent)]" />
          Also forward Inbox messages to my email
        </label>
        {saved.message && <p className={`text-sm ${saved.ok ? "text-accent" : "text-red-700"}`} role="status">{saved.message}</p>}
        <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </form>
      <form action={testAction} className="card flex flex-wrap items-center gap-3 p-6">
        <p className="flex-1 text-sm">Send yourself a test email to see how customers will see it.</p>
        <button className="btn-ghost" disabled={testing}>{testing ? "Sending…" : "Send test email"}</button>
        {tested.message && <p className={`w-full text-sm ${tested.ok ? "text-accent" : "text-red-700"}`} role="status">{tested.message}</p>}
      </form>
    </div>
  );
}
