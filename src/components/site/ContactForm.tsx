"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";

type State = { ok?: boolean; message?: string };

/** The website's contact form; a message becomes a lead or client in the owner's app. */
export function ContactForm({ action }: { action: (prev: State, form: FormData) => Promise<State> }) {
  const [state, submit, pending] = useActionState(action, {});
  if (state.ok) return <p className="card max-w-xl p-6 text-lg font-semibold text-accent">{state.message}</p>;
  return (
    <form action={submit} className="card grid max-w-xl gap-4 p-6 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="c-name">Name</label>
        <input id="c-name" name="name" className="input" required maxLength={100} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="c-email">Email</label>
        <input id="c-email" name="email" type="email" className="input" autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="c-phone">Phone</label>
        <input id="c-phone" name="phone" type="tel" className="input" autoComplete="tel" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="c-msg">How can we help?</label>
        <textarea id="c-msg" name="message" className="input" rows={4} maxLength={2000} />
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state.message && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">{state.message}</p>}
      <button className="btn-primary sm:col-span-2 sm:justify-self-start" disabled={pending}><Send className="h-4 w-4" /> {pending ? "Sending…" : "Send"}</button>
    </form>
  );
}
