"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { useEditOptional } from "./editContext";
import { newId } from "@/engine/editing";
import type { Field } from "@/schema/blueprint";

const SWATCHES = ["#2B6CB0", "#3B7DC4", "#0E7490", "#17694F", "#B7791F", "#C2410C", "#B42318", "#6B46C1", "#8B5CF6", "#6E685D"];
type Option = { id: string; label: string; color?: string };

/**
 * The choices of a field (a service's categories, a board's stages): rename, recolour, reorder,
 * add and remove. Saved at once; removing a choice that records use asks the owner first.
 */
export function ChoicesEditor({ open, onClose, table, fieldId }: { open: boolean; onClose: () => void; table: string; fieldId: string }) {
  const edit = useEditOptional();
  const field = edit?.blueprint.tables.find((t) => t.id === table)?.fields.find((f) => f.id === fieldId);
  const original = field && "options" in field ? (field.options as Option[]) : [];
  const [options, setOptions] = useState<Option[]>(original);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!edit || !field || !("options" in field)) return null;
  const set = (i: number, patch: Partial<Option>) => setOptions((o) => o.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const add = () => {
    const l = newLabel.trim();
    if (!l || options.some((o) => o.label.toLowerCase() === l.toLowerCase())) return;
    setOptions((o) => [...o, { id: newId("opt", l, new Set(o.map((x) => x.id))), label: l, color: SWATCHES[o.length % SWATCHES.length] }]);
    setNewLabel("");
  };
  const save = async () => {
    const clean = options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (!clean.length) return setError("Keep at least one choice.");
    setBusy(true);
    const err = await edit.applyNow([{ op: "updateField", tableId: table, field: { ...field, options: clean } as Field }], `Change the choices of ${field.label}`);
    setBusy(false);
    if (err) return setError(/approval/i.test(err) ? "Removing a choice that records use needs your approval — move those records first, or ask the assistant to do it." : err);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Choices for ${field.label}`}>
      <div className="grid gap-3">
        <ul className="grid gap-2">
          {options.map((o, i) => (
            <li key={o.id} className="flex items-center gap-2">
              <div className="flex gap-1">
                <button type="button" disabled={i === 0} onClick={() => setOptions((x) => { const c = [...x]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })} className="rounded-full px-1.5 text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${o.label} up`}>↑</button>
                <button type="button" disabled={i === options.length - 1} onClick={() => setOptions((x) => { const c = [...x]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c; })} className="rounded-full px-1.5 text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${o.label} down`}>↓</button>
              </div>
              <input className="input min-w-0 flex-1 py-1.5" value={o.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Choice name" />
              <div className="flex gap-1" role="radiogroup" aria-label={`Colour of ${o.label}`}>
                {SWATCHES.slice(0, 6).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={o.color === c} onClick={() => set(i, { color: c })} className={`h-5 w-5 rounded-full ${o.color === c ? "ring-2 ring-ink ring-offset-1" : ""}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
              <button type="button" onClick={() => setOptions((x) => x.filter((_, n) => n !== i))} className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${o.label}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="input min-w-0 flex-1 py-1.5" placeholder="New choice" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} aria-label="New choice" />
          <button className="btn-ghost px-3 py-1.5 text-sm"><Plus className="h-4 w-4" /> Add</button>
        </form>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Dialog>
  );
}
