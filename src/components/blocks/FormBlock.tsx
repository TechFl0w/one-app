"use client";

import { useActionState } from "react";
import type { Field } from "@/schema/blueprint";

export type FormState = { ok?: boolean; message?: string; fields?: Record<string, string>; nonce?: number };
export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

/** Form for creating a record. Field ids are the input names; the server converts and validates. */
export function FormBlock({
  fields,
  choices,
  action,
  submitLabel = "Save",
}: {
  fields: Field[];
  choices: Record<string, { id: string; label: string }[]>;
  action: FormAction;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form key={state.ok ? state.nonce : "form"} action={formAction} className="flex h-full flex-col gap-3 overflow-auto px-5 pb-5">
      {fields.map((f) => (
        <div key={f.id}>
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name={f.id} className="h-4 w-4 accent-[var(--accent)]" />
              {f.label}
            </label>
          ) : (
            <>
              <label className="label" htmlFor={`f-${f.id}`}>
                {f.label}
                {f.required && <span className="text-accent"> *</span>}
              </label>
              <Input field={f} choices={choices[f.id]} />
            </>
          )}
          {state.fields?.[f.id] && <p className="mt-1 text-xs text-red-700">{state.fields[f.id]}</p>}
        </div>
      ))}
      {state.message && (
        <p className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-accent-tint text-accent" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
      <button className="btn-primary mt-auto self-start" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function Input({ field: f, choices }: { field: Field; choices?: { id: string; label: string }[] }) {
  const common = { id: `f-${f.id}`, name: f.id, required: f.required, className: "input" };
  switch (f.type) {
    case "long_text":
      return <textarea {...common} rows={3} />;
    case "number":
      return <input {...common} type="number" step="any" inputMode="decimal" />;
    case "money":
      return <input {...common} type="number" step="0.01" min="0" inputMode="decimal" />;
    case "date":
      return <input {...common} type="date" />;
    case "datetime":
      return <input {...common} type="datetime-local" />;
    case "email":
      return <input {...common} type="email" autoComplete="email" />;
    case "phone":
      return <input {...common} type="tel" autoComplete="tel" />;
    case "status":
    case "choice":
    case "link": {
      const opts = f.type === "link" ? (choices ?? []) : f.options.map((o) => ({ id: o.id, label: o.label }));
      return (
        <select {...common} multiple={"multiple" in f && f.multiple} defaultValue={"multiple" in f && f.multiple ? [] : ""}>
          {!("multiple" in f && f.multiple) && <option value="">{f.required ? "Choose…" : "—"}</option>}
          {opts.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      );
    }
    default:
      return <input {...common} type="text" />;
  }
}
