"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
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
      return <DatePicker id={common.id} name={f.id} required={f.required} />;
    case "datetime":
      return <DatePicker id={common.id} name={f.id} required={f.required} withTime />;
    case "email":
      return <input {...common} type="email" autoComplete="email" />;
    case "phone":
      return <input {...common} type="tel" autoComplete="tel" />;
    case "status":
    case "choice":
    case "link": {
      const opts = f.type === "link" ? (choices ?? []) : f.options.map((o) => ({ id: o.id, label: o.label }));
      return <ChoiceInput id={common.id} name={f.id} required={f.required} multiple={"multiple" in f && !!f.multiple} options={opts} />;
    }
    default:
      return <input {...common} type="text" />;
  }
}

function ChoiceInput({ id, name, required, multiple, options }: { id: string; name: string; required?: boolean; multiple: boolean; options: { id: string; label: string }[] }) {
  const [value, setValue] = useState<string | string[]>(multiple ? [] : "");
  return (
    <Select
      id={id}
      name={name}
      required={required}
      multiple={multiple}
      value={value}
      onChange={setValue}
      placeholder={required ? "Choose…" : "—"}
      options={[...(!multiple && !required && value ? [{ value: "", label: "—" }] : []), ...options.map((o) => ({ value: o.id, label: o.label }))]}
    />
  );
}
