"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import type { Field } from "@/schema/blueprint";

export type FormState = { ok?: boolean; message?: string; fields?: Record<string, string>; nonce?: number };
export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

/** Form for creating a record. Field ids are the input names; the server converts and validates. */
type Choice = { id: string; label: string; parent?: string };

export function FormBlock({
  fields,
  choices,
  narrow = {},
  action,
  submitLabel = "Save",
}: {
  fields: Field[];
  choices: Record<string, Choice[]>;
  /** Child picker → the picker that narrows it (a pet by its owner). */
  narrow?: Record<string, string>;
  action: FormAction;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // Link pickers are controlled here so an owner narrows pets and a pet fills its owner.
  const [links, setLinks] = useState<Record<string, string | string[]>>({});
  // A saved form starts empty again.
  const [seen, setSeen] = useState(state.nonce);
  if (state.ok && state.nonce !== seen) {
    setSeen(state.nonce);
    setLinks({});
  }
  const setLink = (id: string, v: string | string[]) => {
    const next: Record<string, string | string[]> = { [id]: v };
    const parent = narrow[id];
    const picked = typeof v === "string" ? choices[id]?.find((o) => o.id === v) : undefined;
    if (parent && picked?.parent) next[parent] = picked.parent;
    for (const [child, p] of Object.entries(narrow)) {
      if (p !== id) continue;
      const fits = (choices[child] ?? []).filter((o) => !v || o.parent === v);
      const cur = links[child];
      if (typeof cur === "string" && cur && !fits.some((o) => o.id === cur)) next[child] = "";
      if ((!cur || next[child] === "") && fits.length === 1 && v) next[child] = fits[0].id;
    }
    setLinks((x) => ({ ...x, ...next }));
  };
  const optionsFor = (id: string) => {
    const p = narrow[id];
    const pv = p ? links[p] : undefined;
    return (choices[id] ?? []).filter((o) => !p || !pv || o.parent === pv);
  };

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
              {f.type === "link" ? (
                <ChoiceInput id={`f-${f.id}`} name={f.id} required={f.required} multiple={!!f.multiple} options={optionsFor(f.id)} value={links[f.id] ?? (f.multiple ? [] : "")} onChange={(v) => setLink(f.id, v)} />
              ) : (
                <Input field={f} choices={choices[f.id]} />
              )}
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

function ChoiceInput({ id, name, required, multiple, options, value: controlled, onChange }: { id: string; name: string; required?: boolean; multiple: boolean; options: { id: string; label: string }[]; value?: string | string[]; onChange?: (v: string | string[]) => void }) {
  const [own, setOwn] = useState<string | string[]>(multiple ? [] : "");
  const value = controlled ?? own;
  const setValue = onChange ?? setOwn;
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
