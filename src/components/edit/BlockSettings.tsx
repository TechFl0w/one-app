"use client";

import { Select } from "@/components/ui/Select";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Block, Field, LayoutKey, Table } from "@/schema/blueprint";
import { ADDABLE_FIELD_TYPES, newFieldOp } from "@/engine/editing";
import { Dialog } from "./Dialog";
import { useEdit } from "./EditProvider";

const TYPE_LABEL = Object.fromEntries(ADDABLE_FIELD_TYPES.map((t) => [t.type, t.label])) as Record<string, string>;

/** Block title + the fields of the block's table (rename, add, remove). */
export function BlockSettings({
  open,
  onClose,
  pageId,
  block,
  layout,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
  block: Block;
  layout?: LayoutKey;
}) {
  const { blueprint, push } = useEdit();
  const table = block.source && blueprint.tables.find((t) => t.id === block.source!.table);
  const title = typeof block.options?.title === "string" ? block.options.title : "";

  const setTitle = (value: string) => {
    if (value.trim() === title) return;
    const options = { ...block.options };
    if (value.trim()) options.title = value.trim();
    else delete options.title;
    push({ op: "updateBlock", pageId, layout, block: { ...block, options } });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Block settings" side>
      <div className="space-y-8">
        <div>
          <label className="label" htmlFor={`title-${block.id}`}>Title</label>
          <input
            id={`title-${block.id}`}
            className="input"
            defaultValue={title}
            placeholder={table?.label ?? "Untitled"}
            maxLength={80}
            onBlur={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        {block.type === "notes" && <NoteText pageId={pageId} block={block} layout={layout} />}
        {table && <FieldsEditor table={table} />}
      </div>
    </Dialog>
  );
}

function NoteText({ pageId, block, layout }: { pageId: string; block: Block; layout?: LayoutKey }) {
  const { push } = useEdit();
  const text = typeof block.options?.text === "string" ? block.options.text : "";
  return (
    <div>
      <label className="label" htmlFor={`text-${block.id}`}>Text</label>
      <textarea
        id={`text-${block.id}`}
        className="input"
        rows={5}
        defaultValue={text}
        maxLength={5000}
        onBlur={(e) => e.target.value !== text && push({ op: "updateBlock", pageId, layout, block: { ...block, options: { ...block.options, text: e.target.value } } })}
      />
    </div>
  );
}

function FieldsEditor({ table }: { table: Table }) {
  const { push } = useEdit();

  const rename = (f: Field, label: string) => {
    if (!label.trim() || label.trim() === f.label) return;
    push({ op: "rename", target: { kind: "field", tableId: table.id, fieldId: f.id }, label: label.trim() });
  };

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Fields of {table.label}</h3>
      <p className="mb-3 text-xs text-muted">Renaming is safe: automations and reports keep working.</p>
      <ul className="space-y-2">
        {table.fields.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <input
              aria-label={`Rename ${f.label}`}
              className="input py-2"
              defaultValue={f.label}
              maxLength={80}
              onBlur={(e) => rename(f, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <span className="w-24 shrink-0 truncate text-xs text-muted">{TYPE_LABEL[f.type] ?? f.type}</span>
            <button
              type="button"
              className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-700"
              aria-label={`Remove ${f.label}`}
              onClick={() => push({ op: "removeField", tableId: table.id, fieldId: f.id })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <AddField table={table} />
    </section>
  );
}

function AddField({ table }: { table: Table }) {
  const { blueprint, push } = useEdit();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<Field["type"]>("text");
  const [options, setOptions] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const op = newFieldOp(blueprint, table, { label, type, options: options.split(","), linkTo });
    if (typeof op === "string") return setProblem(op);
    if (push(op)) {
      setLabel("");
      setOptions("");
      setProblem(null);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-2xl bg-ground p-4">
      <p className="text-sm font-semibold">Add a field</p>
      <div className="flex gap-2">
        <input className="input" placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} aria-label="New field name" />
        <Select className="w-44 shrink-0" value={type} onChange={(v) => setType(v as Field["type"])} ariaLabel="New field type" options={ADDABLE_FIELD_TYPES.map((t) => ({ value: t.type, label: t.label }))} />
      </div>
      {(type === "status" || type === "choice") && (
        <input className="input" placeholder="Options, separated by commas" value={options} onChange={(e) => setOptions(e.target.value)} aria-label="Options" />
      )}
      {type === "link" && (
        <Select value={linkTo} onChange={(v) => setLinkTo(v as string)} ariaLabel="Link to table" placeholder="Link to…" options={blueprint.tables.map((t) => ({ value: t.id, label: t.label }))} />
      )}
      {problem && <p className="text-sm text-red-700">{problem}</p>}
      <button type="button" className="btn-primary px-4 py-2" onClick={add}>Add field</button>
    </div>
  );
}
