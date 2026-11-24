"use client";

import { useActionState } from "react";
import { createBusinessAction } from "./actions";

export function CreateBusinessForm() {
  const [state, action, pending] = useActionState(createBusinessAction, {});

  return (
    <form
      action={(form) => {
        form.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
        return action(form);
      }} className="card w-full max-w-md space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-bold">Let’s set up your business</h1>
        <p className="mt-1 text-sm text-muted">Start with a name. You can change everything later.</p>
      </div>
      <div>
        <label className="label" htmlFor="name">Business name</label>
        <input className="input" id="name" name="name" placeholder="Polished Nail Bar" maxLength={80} required />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>Create business</button>
    </form>
  );
}
