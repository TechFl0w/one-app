"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/edit/Dialog";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import type { SandboxBridge, SandboxRecord, SandboxSchema } from "@/sandbox/protocol";
import { unwrap } from "@/sandbox/result";
import { MediaUploader } from "@/components/media/Media";
import { AddField, ChoiceInput, HoursInput } from "./FormParts";
import { singular } from "@/lib/words";
import { belongsTo, impliedParent, narrowings, parentFieldOf } from "@/engine/hierarchy";
export { singular };

type Table = SandboxSchema["tables"][number];
type Field = Table["fields"][number];

export interface RecordFormRequest {
  table: string;
  recordId?: string;
  fields?: string[];
  title?: string;
  submitLabel?: string;
  /** Prefilled values for a new record (e.g. the client you're looking at). */
  defaults?: Record<string, unknown>;
}

const SKIP = new Set(["rollup", "formula"]);
const pad = (n: number) => String(n).padStart(2, "0");
function toLocal(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function labelOf(t: Table | undefined, r: SandboxRecord) {
  const f = t?.fields.find((x) => x.id === t.primaryField) ?? t?.fields.find((x) => x.type === "text");
  const v = f ? r.data[f.id] : undefined;
  if (v == null || v === "") return "Untitled";
  return f?.options?.find((o) => o.id === v)?.label ?? String(v);
}

/** Validates what a frame asked for: known table, known fields. */
export function parseFormRequest(v: unknown, schema: SandboxSchema): RecordFormRequest {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid form request");
  const o = v as Record<string, unknown>;
  const t = schema.tables.find((x) => x.id === o.table);
  if (!t) throw new Error("Unknown table");
  const text = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.slice(0, max) : undefined);
  const fields = Array.isArray(o.fields) ? o.fields.filter((f): f is string => typeof f === "string" && t.fields.some((x) => x.id === f)).slice(0, 40) : undefined;
  const defaults = o.defaults && typeof o.defaults === "object" && !Array.isArray(o.defaults) ? (o.defaults as Record<string, unknown>) : undefined;
  return { table: t.id, recordId: text(o.recordId, 200), fields: fields?.length ? fields : undefined, title: text(o.title, 80), submitLabel: text(o.submitLabel, 40), defaults };
}

/**
 * The add/edit form a generated component opens with openRecordForm(): drawn by One App as a
 * real modal over the whole page (a frame can only draw inside its own box).
 */
export function RecordDialog({ request, schema, bridge, onDone }: { request: RecordFormRequest | null; schema: SandboxSchema; bridge: SandboxBridge; onDone: (saved: SandboxRecord | null, deleted?: boolean) => void }) {
  const t = schema.tables.find((x) => x.id === request?.table);
  // "Edit client" / "New booking": one record, so the table's name in the singular.
  const one = t ? singular(t.label).toLowerCase() : "";
  const title = request?.title ?? (t ? (request?.recordId ? `Edit ${one}` : `New ${one}`) : "");
  return (
    <Dialog open={!!request && !!t} onClose={() => onDone(null)} title={title}>
      {request && t && <Body key={`${request.table}:${request.recordId ?? "new"}`} request={request} table={t} schema={schema} bridge={bridge} onDone={onDone} />}
    </Dialog>
  );
}

function Body({ request, table: t, schema, bridge, onDone }: { request: RecordFormRequest; table: Table; schema: SandboxSchema; bridge: SandboxBridge; onDone: (saved: SandboxRecord | null, deleted?: boolean) => void }) {
  const editing = !!request.recordId;
  // New records: each status starts at its first option, then whatever the screen prefilled.
  const statusDefaults = Object.fromEntries(t.fields.filter((f) => f.type === "status" && f.options?.length).map((f) => [f.id, f.options![0].id]));
  const [values, setValues] = useState<Record<string, unknown> | null>(editing ? null : { ...statusDefaults, ...(request.defaults ?? {}) });
  const [links, setLinks] = useState<Record<string, { value: string; label: string }[]>>({});
  const [linkRecs, setLinkRecs] = useState<Record<string, SandboxRecord[]>>({});
  // Link pickers are controlled here so one can narrow another (owner → pets).
  const [linkVals, setLinkVals] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAmount, setConfirmAmount] = useState<"no" | "asking" | "yes">("no");
  const [deleting, setDeleting] = useState<"no" | "asking" | "busy">("no");
  const remove = async () => {
    setDeleting("busy");
    const r = await bridge.remove(t.id, request.recordId!);
    if (r.ok) return onDone(null, true);
    setError(r.error);
    setDeleting("no");
  };
  // Fields the owner added from this form ("+ Add field") show up right away.
  const [added, setAdded] = useState<Field[]>([]);
  const all = t.fields.filter((f) => !SKIP.has(f.type) && !f.computed);
  const shown = [
    ...(request.fields ? request.fields.map((id) => all.find((f) => f.id === id)).filter((f): f is Field => !!f) : all),
    ...added.filter((a) => !t.fields.some((f) => f.id === a.id) || request.fields),
  ].filter((f, i, list) => list.findIndex((x) => x.id === f.id) === i);

  const narrow = narrowings(schema.tables, t.id, shown.map((f) => f.id));
  const asVal = (f: Field, v: unknown): string | string[] => (f.multiple ? (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []) : v == null ? "" : String(v));
  const linkVal = (f: Field) => linkVals[f.id] ?? asVal(f, values?.[f.id]);
  const recOf = (f: Field, id: string) => linkRecs[f.to ?? ""]?.find((r) => r.id === id);
  const setLink = (f: Field, v: string | string[]) => {
    const next: Record<string, string | string[]> = { [f.id]: v };
    // Choosing a pet fills in its owner.
    const up = narrow[f.id];
    const parentF = up && shown.find((x) => x.id === up.parent);
    if (up && parentF && typeof v === "string" && v) {
      const p = impliedParent(recOf(f, v), up.via);
      if (p && linkVal(parentF) !== p) next[parentF.id] = parentF.multiple ? [p] : p;
    }
    // Choosing an owner keeps only their pets — and picks the pet when there's just one.
    for (const [childId, n] of Object.entries(narrow)) {
      if (n.parent !== f.id) continue;
      const child = shown.find((x) => x.id === childId);
      if (!child) continue;
      const fits = (linkRecs[child.to ?? ""] ?? []).filter((r) => belongsTo(r, n.via, v));
      const cur = linkVal(child);
      const keep = (Array.isArray(cur) ? cur : [cur]).filter((id) => id && fits.some((r) => r.id === id));
      if (!keep.length && fits.length === 1 && v && (!Array.isArray(v) || v.length)) next[child.id] = child.multiple ? [fits[0].id] : fits[0].id;
      else next[child.id] = child.multiple ? keep : keep[0] ?? "";
    }
    setLinkVals((x) => ({ ...x, ...next }));
  };
  const optionsFor = (f: Field) => {
    const all = links[f.to ?? ""] ?? [];
    const n = narrow[f.id];
    const parentF = n && shown.find((x) => x.id === n.parent);
    if (!n || !parentF) return all;
    const pv = linkVal(parentF);
    const recs = linkRecs[f.to ?? ""] ?? [];
    return all.filter((o) => { const r = recs.find((x) => x.id === o.value); return !r || belongsTo(r, n.via, pv); });
  };
  /** "+ New pet": made with its name (and the owner already chosen), then selected. */
  const addLinked = (f: Field) => async (label: string): Promise<string | null> => {
    const lt = schema.tables.find((x) => x.id === f.to);
    const title = lt?.fields.find((x) => x.id === lt.primaryField);
    if (!lt || !title || !["text", "email", "phone"].includes(title.type)) return null;
    const data: Record<string, unknown> = { [title.id]: label };
    const n = narrow[f.id];
    const parentF = n && shown.find((x) => x.id === n.parent);
    const pv = parentF ? linkVal(parentF) : "";
    if (n && pv && (!Array.isArray(pv) || pv.length)) data[n.via] = Array.isArray(pv) ? pv[0] : pv;
    const r = await bridge.create(lt.id, data);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    const parentLabel = parentF ? (links[parentF.to ?? ""] ?? []).find((o) => o.value === data[n!.via])?.label.split(" · ")[0] : undefined;
    setLinkRecs((x) => ({ ...x, [lt.id]: [...(x[lt.id] ?? []), r.value] }));
    setLinks((x) => ({ ...x, [lt.id]: [...(x[lt.id] ?? []), { value: r.value.id, label: parentLabel ? `${label} · ${parentLabel}` : label }] }));
    return r.value.id;
  };

  useEffect(() => {
    let live = true;
    if (request.recordId)
      bridge.get(t.id, request.recordId).then(unwrap).then(
        (r) => live && setValues(r.data),
        (e) => live && setError(e instanceof Error ? e.message : "Couldn’t load"),
      );
    const linked = [...new Set(shown.filter((f) => f.type === "link" && f.to).map((f) => f.to!))];
    for (const to of linked)
      bridge.list({ table: to, limit: 500 }).then(unwrap).then(async (res) => {
        const lt = schema.tables.find((x) => x.id === to);
        // A title that is itself a link (a lease named by its tenant) shows that record's name;
        // a record that belongs to another shows the path ("Biscuit · Lisa Moreau").
        const title = lt?.fields.find((f) => f.id === lt.primaryField);
        const parentF = parentFieldOf(schema.tables, to);
        const nameOf = async (field: Field | undefined) => {
          const names = new Map<string, string>();
          if (!field || field.type !== "link" || !field.to) return names;
          const tt = schema.tables.find((x) => x.id === field.to);
          const want = new Set(res.records.flatMap((r) => (Array.isArray(r.data[field.id]) ? (r.data[field.id] as unknown[]) : [r.data[field.id]])).filter((v): v is string => typeof v === "string"));
          if (want.size) for (const r of unwrap(await bridge.list({ table: field.to, limit: 500 })).records) if (want.has(r.id)) names.set(r.id, labelOf(tt, r));
          return names;
        };
        const [titles, parents] = await Promise.all([nameOf(title), nameOf(parentF as Field | undefined)]);
        if (!live) return;
        const label = (r: SandboxRecord) => {
          const own = title?.type === "link" ? titles.get(String(r.data[title.id])) ?? "Untitled" : labelOf(lt, r);
          const p = parentF ? parents.get(String(r.data[parentF.id])) : undefined;
          return p ? `${own} · ${p}` : own;
        };
        const opts = res.records.map((r) => ({ value: r.id, label: label(r) })).sort((a, b) => a.label.localeCompare(b.label));
        setLinkRecs((x) => ({ ...x, [to]: res.records }));
        setLinks((x) => ({ ...x, [to]: opts }));
      }, () => {});
    return () => {
      live = false;
    };
    // Loads once per opened form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (form: FormData) => {
    setBusy(true);
    setError(null);
    const data: Record<string, unknown> = {};
    for (const f of shown) {
      const raw = form.get(f.id);
      const s = typeof raw === "string" ? raw.trim() : "";
      let v: unknown;
      const several = f.multiple && (f.type === "choice" || f.type === "link");
      if (f.type === "checkbox") v = form.has(f.id);
      else if (several) {
        const list = form.getAll(f.id).map(String).filter(Boolean);
        v = list.length ? list : null;
      } else if (!s) v = null;
      else if (f.type === "hours") v = JSON.parse(s);
      else if (f.type === "file") v = JSON.parse(s);
      else if (f.type === "number" || f.type === "money") v = Number(s);
      else if (f.type === "datetime") v = new Date(s).toISOString();
      else v = s;
      if (v !== null || editing) data[f.id] = v;
    }
    if (!editing) for (const [k, v] of Object.entries({ ...statusDefaults, ...(request.defaults ?? {}) })) if (!(k in data) && t.fields.some((f) => f.id === k)) data[k] = v;
    try {
      if (!editing) return onDone(unwrap(await bridge.create(t.id, data)));
      const r = await bridge.update(t.id, request.recordId!, data, confirmAmount === "yes");
      // Amount changes: ask once, inline, then save with the owner's OK.
      if (!r.ok && r.code === "needs_confirmation") {
        setConfirmAmount("asking");
        return setBusy(false);
      }
      onDone(unwrap(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save");
      setBusy(false);
    }
  };

  if (!values) return error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-muted">Loading…</p>;
  return (
    <form action={submit} className="grid gap-4">
      {shown.map((f) => (
        <div key={f.id}>
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name={f.id} defaultChecked={values[f.id] === true} className="h-4 w-4 accent-[var(--accent)]" />
              {f.label}
            </label>
          ) : (
            <>
              <label className="label" htmlFor={`rf-${f.id}`}>
                {f.label}
                {f.required && <span className="text-accent"> *</span>}
              </label>
              {f.type === "link" ? (
                <Select
                  id={`rf-${f.id}`}
                  name={f.id}
                  required={f.required}
                  multiple={f.multiple}
                  value={linkVal(f)}
                  onChange={(v) => setLink(f, v)}
                  placeholder={f.required ? "Choose…" : "—"}
                  options={[...(!f.multiple && !f.required && linkVal(f) ? [{ value: "", label: "—" }] : []), ...optionsFor(f)]}
                  onAdd={addLinked(f)}
                  addLabel={singular(schema.tables.find((x) => x.id === f.to)?.label ?? f.label).toLowerCase()}
                  searchable
                />
              ) : (
                <FieldInput field={f} value={values[f.id]} table={t.id} bridge={bridge} options={(f.options ?? []).map((o) => ({ value: o.id, label: o.label }))} />
              )}
            </>
          )}
        </div>
      ))}
      <AddField table={t.id} onAdded={(f) => setAdded((x) => [...x, f])} />
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {confirmAmount === "asking" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This changes an amount. Save it?{" "}
          <button type="submit" className="font-semibold underline" onClick={() => setConfirmAmount("yes")}>Yes, save</button>
        </p>
      )}
      {deleting === "asking" && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          Delete this {t.label.replace(/s$/, "").toLowerCase()}? It’s kept in the activity log.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void remove()}>Yes, delete</button>
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {editing && (
          <button type="button" className="mr-auto text-sm font-medium text-red-700 hover:underline" disabled={deleting === "busy"} onClick={() => setDeleting("asking")}>
            {deleting === "busy" ? "Deleting…" : "Delete"}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : (request.submitLabel ?? (editing ? "Save" : "Add"))}</button>
      </div>
    </form>
  );
}

function FieldInput({ field: f, value, options, table, bridge }: { field: Field; value: unknown; options: { value: string; label: string }[]; table: string; bridge: SandboxBridge }) {
  const id = `rf-${f.id}`;
  const str = value == null ? "" : String(value);
  const common = { id, name: f.id, required: f.required, className: "input", defaultValue: str };
  switch (f.type) {
    case "long_text":
      return <textarea {...common} rows={3} />;
    case "number":
      return <input {...common} type="number" step="any" inputMode="decimal" />;
    case "money":
      return <input {...common} type="number" step="0.01" inputMode="decimal" />;
    case "date":
      return <DatePicker id={id} name={f.id} required={f.required} defaultValue={str.slice(0, 10)} />;
    case "datetime":
      return <DatePicker id={id} name={f.id} required={f.required} withTime defaultValue={str ? toLocal(str) : ""} />;
    case "file":
      return <FileField id={id} name={f.id} required={f.required} initial={value} table={table} field={f.id} label={f.label} multiple={f.multiple} bridge={bridge} />;
    case "email":
      return <input {...common} type="email" autoComplete="off" />;
    case "phone":
      return <input {...common} type="tel" autoComplete="off" />;
    case "status":
    case "choice":
    case "link":
      return <ChoiceInput id={id} name={f.id} required={f.required} initial={value} options={options} table={table} field={f} multiple={f.multiple} />;
    case "hours":
      return <HoursInput name={f.id} initial={value} />;
    default:
      return <input {...common} type="text" />;
  }
}

/** Photos, videos or files for a file field: uploaded as they're picked, saved with the form. */
function FileField({ id, name, required, initial, table, field, label, multiple, bridge }: { id: string; name: string; required?: boolean; initial: unknown; table: string; field: string; label: string; multiple?: boolean; bridge: SandboxBridge }) {
  const [value, setValue] = useState<unknown>(initial);
  const media = multiple || /photo|picture|image|logo|cover|receipt|video|gallery|before|after/i.test(label);
  return <MediaUploader id={id} name={name} required={required} bridge={bridge} table={table} field={field} value={value} onChange={setValue} multiple={multiple} accept={media ? "image/*,video/*" : "*/*"} />;
}
