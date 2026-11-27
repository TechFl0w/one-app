"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Select, timeOptions } from "@/components/ui/Select";
import { useEditOptional } from "@/components/edit/editContext";
import { ChoicesEditor } from "@/components/edit/ChoicesEditor";
import { newId } from "@/engine/editing";
import { singular } from "@/lib/words";
import type { Field as BpField } from "@/schema/blueprint";
import type { SandboxSchema } from "@/sandbox/protocol";

type Field = SandboxSchema["tables"][number]["fields"][number];

/**
 * A choice in a form (status, category, linked record). Choice fields end with "+ Add …": the
 * owner adds "Kids" or "Bridal" right there, and it's a choice everywhere from then on.
 */
export function ChoiceInput({ id, name, required, initial, options, table, field, multiple }: { id: string; name: string; required?: boolean; initial: unknown; options: { value: string; label: string }[]; table: string; field: Field; multiple?: boolean }) {
  const edit = useEditOptional();
  const [value, setValue] = useState<string | string[]>(multiple ? (Array.isArray(initial) ? initial.map(String) : initial ? [String(initial)] : []) : initial == null ? "" : String(initial));
  const [extra, setExtra] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bpField = edit?.blueprint.tables.find((t) => t.id === table)?.fields.find((f) => f.id === field.id);
  const canAdd = !!edit && !!bpField && (bpField.type === "choice" || bpField.type === "status") && !("derive" in bpField && bpField.derive);
  const onAdd = canAdd
    ? async (label: string) => {
        if (!bpField || !("options" in bpField)) return null;
        const existing = bpField.options.find((o) => o.label.toLowerCase() === label.toLowerCase());
        if (existing) return existing.id;
        const optionId = newId("opt", label, new Set(bpField.options.map((o) => o.id)));
        const err = await edit!.applyNow([{ op: "updateField", tableId: table, field: { ...bpField, options: [...bpField.options, { id: optionId, label }] } as BpField }], `Add “${label}” as a choice for ${field.label}`);
        if (err) {
          setError(err);
          return null;
        }
        setError(null);
        setExtra((x) => [...x, { value: optionId, label }]);
        return optionId;
      }
    : undefined;
  const [editing, setEditing] = useState(false);
  const all = [...options, ...extra.filter((e) => !options.some((o) => o.value === e.value))];
  return (
    <>
      <Select
        id={id}
        name={name}
        required={required}
        multiple={multiple}
        value={value}
        onChange={setValue}
        placeholder={required ? "Choose…" : "—"}
        options={[...(!multiple && !required && value ? [{ value: "", label: "—" }] : []), ...all]}
        onAdd={onAdd}
        addLabel={singular(field.label).toLowerCase()}
        onEditChoices={canAdd ? () => setEditing(true) : undefined}
      />
      {editing && <ChoicesEditor open onClose={() => setEditing(false)} table={table} fieldId={field.id} />}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </>
  );
}

// ---------- weekly hours ----------

const DAYS: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
type Hours = Record<string, [string, string][]>;

/**
 * Working hours for a week: tick the days, set from–to. Empty means "the business's opening
 * hours" (for staff), which the booking engine uses when a person has no hours of their own.
 */
export function HoursInput({ name, initial, emptyHint = "Same as the opening hours" }: { name: string; initial: unknown; emptyHint?: string }) {
  const [hours, setHours] = useState<Hours>(() => (initial && typeof initial === "object" ? (initial as Hours) : {}));
  const times = timeOptions(15);
  const set = (day: string, range: [string, string] | null) => setHours((h) => {
    const next = { ...h };
    if (range) next[day] = [range];
    else delete next[day];
    return next;
  });
  const empty = !Object.keys(hours).length;
  return (
    <div className="space-y-1.5">
      <input type="hidden" name={name} value={empty ? "" : JSON.stringify(hours)} />
      {empty && <p className="text-xs text-muted">{emptyHint} — tick a day to set your own.</p>}
      {DAYS.map(([d, label]) => {
        const r = hours[d]?.[0];
        return (
          <div key={d} className="flex items-center gap-2">
            <label className="flex w-16 shrink-0 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!r} onChange={(e) => set(d, e.target.checked ? ["09:00", "17:00"] : null)} />
              {label}
            </label>
            {r ? (
              <>
                <Select size="sm" className="w-32" value={r[0]} onChange={(v) => set(d, [String(v), r[1]])} options={times} ariaLabel={`${label} from`} />
                <span className="text-sm text-muted">to</span>
                <Select size="sm" className="w-32" value={r[1]} onChange={(v) => set(d, [r[0], String(v)])} options={times} ariaLabel={`${label} until`} />
              </>
            ) : (
              <span className="text-sm text-muted">Off</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- adding a field ----------

const KINDS: { id: string; label: string; field: (id: string, label: string, options: { id: string; label: string }[]) => BpField }[] = [
  { id: "text", label: "Text", field: (id, label) => ({ id, label, type: "text" }) },
  { id: "long_text", label: "Longer text (notes)", field: (id, label) => ({ id, label, type: "long_text" }) },
  { id: "number", label: "Number", field: (id, label) => ({ id, label, type: "number" }) },
  { id: "money", label: "Money", field: (id, label) => ({ id, label, type: "money" }) },
  { id: "date", label: "Date", field: (id, label) => ({ id, label, type: "date" }) },
  { id: "datetime", label: "Date and time", field: (id, label) => ({ id, label, type: "datetime" }) },
  { id: "checkbox", label: "Yes / no", field: (id, label) => ({ id, label, type: "checkbox" }) },
  { id: "choice", label: "Pick one", field: (id, label, options) => ({ id, label, type: "choice", options }) },
  { id: "choices", label: "Pick several", field: (id, label, options) => ({ id, label, type: "choice", multiple: true, options }) },
  { id: "photos", label: "Photos", field: (id, label) => ({ id, label, type: "file", multiple: true }) },
  { id: "file", label: "File", field: (id, label) => ({ id, label, type: "file" }) },
  { id: "phone", label: "Phone", field: (id, label) => ({ id, label, type: "phone" }) },
  { id: "email", label: "Email", field: (id, label) => ({ id, label, type: "email" }) },
];

/**
 * "+ Add field" under a form: the owner names it ("Specialities"), picks a kind in plain words,
 * and it's on this form, the record page and lists from then on. Adding deletes nothing, so no
 * approval is needed.
 */
export function AddField({ table, onAdded }: { table: string; onAdded: (f: Field) => void }) {
  const edit = useEditOptional();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("text");
  const [choices, setChoices] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const t = edit?.blueprint.tables.find((x) => x.id === table);
  // On a quote or invoice the new field can go on the document the client sees too.
  const doc = edit?.blueprint.documents?.find((d) => d.table === table);
  const [onDoc, setOnDoc] = useState(true);
  const [secret, setSecret] = useState(false);
  if (!edit || !t) return null;
  if (!open)
    return (
      <div className="grid gap-1">
        {done && <p role="status" className="rounded-xl bg-accent-tint px-3 py-2 text-sm text-accent">{done}</p>}
        <button type="button" className="inline-flex items-center gap-1 justify-self-start text-sm font-semibold text-accent hover:underline" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add field
        </button>
      </div>
    );
  const pick = kind === "choice" || kind === "choices";
  const add = async () => {
    const name = label.trim();
    if (!name) return setError("Give it a name");
    if (t.fields.some((f) => f.label.toLowerCase() === name.toLowerCase())) return setError(`${t.label} already has “${name}”`);
    const taken = new Set(edit.blueprint.tables.flatMap((x) => x.fields.map((f) => f.id)));
    const id = newId("fld", name, taken);
    const optTaken = new Set<string>();
    const options = pick ? choices.split(/[,\n]/).map((c) => c.trim()).filter(Boolean).slice(0, 50).map((c) => ({ id: newId("opt", c, optTaken), label: c })) : [];
    if (pick && !options.length) return setError("Type the choices, separated by commas");
    const field = { ...KINDS.find((k) => k.id === kind)!.field(id, name, options), ...(secret ? { sensitive: true } : {}) } as BpField;
    setBusy(true);
    const ops: Parameters<typeof edit.applyNow>[0] = [{ op: "addField", tableId: table, field }];
    if (doc && onDoc) ops.push({ op: "setDocument", document: { ...doc, show: [...(doc.show ?? []), id].slice(0, 12) } });
    const err = await edit.applyNow(ops, `Add “${name}” to ${t.label}`);
    setBusy(false);
    if (err) return setError(err);
    onAdded({ id, label: name, type: field.type, ...(options.length ? { options } : {}), ...("multiple" in field && field.multiple ? { multiple: true } : {}) });
    setDone(`“${name}” added to ${t.label} — it’s on this form, the ${singular(t.label).toLowerCase()} page and in lists${doc && onDoc ? `, and on the ${doc.label.toLowerCase()} your client sees` : ""}. Fill it in above.`);
    setOpen(false);
    setLabel("");
    setChoices("");
    setError(null);
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-dashed border-line p-3">
      <p className="text-sm font-semibold">New field on {t.label.toLowerCase()}</p>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-[1_1_10rem]" placeholder="Name, e.g. Specialities" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Field name" />
        <Select className="w-44" value={kind} onChange={(v) => setKind(String(v))} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} ariaLabel="Kind of field" />
      </div>
      {doc && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={onDoc} onChange={(e) => setOnDoc(e.target.checked)} />
          Show it on the {doc.label.toLowerCase()} your client sees
        </label>
      )}
      {(kind === "text" || kind === "long_text" || kind === "number") && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          Private (alarm code, lockbox) — hidden until tapped, kept from the assistant
        </label>
      )}
      {pick && <input className="input" placeholder="Choices, separated by commas (Colour, Balayage, Curly hair)" value={choices} onChange={(e) => setChoices(e.target.value)} aria-label="Choices" />}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-4 py-1.5 text-sm" disabled={busy} onClick={() => void add()}>
          {busy ? "Adding…" : "Add field"}
        </button>
        <button type="button" className="btn-ghost px-4 py-1.5 text-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
