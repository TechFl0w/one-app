"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Block, BlockType, LayoutKey, Page } from "@/schema/blueprint";
import { ADDABLE_BLOCKS, PAGE_TEMPLATES, newBlockOp, newPageOp, type PageTemplate } from "@/engine/editing";
import { Dialog } from "./Dialog";
import { useEdit } from "./EditProvider";

function TablePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { blueprint } = useEdit();
  return (
    <div>
      <label className="label" htmlFor="pick-table">Data from</label>
      <select id="pick-table" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a table…</option>
        {blueprint.tables.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  );
}

export function AddPageDialog({ open, onClose, basePath }: { open: boolean; onClose: () => void; basePath: string }) {
  const { blueprint, push } = useEdit();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [template, setTemplate] = useState<PageTemplate>("blank");
  const [table, setTable] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const needsTable = PAGE_TEMPLATES.find((t) => t.id === template)!.needsTable;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return setProblem("Give the page a name.");
    const op = newPageOp(blueprint, label.trim(), template, table || undefined);
    if (typeof op === "string") return setProblem(op);
    if (push(op) && op.op === "addPage") {
      setLabel("");
      setProblem(null);
      onClose();
      router.push(`${basePath}/p/${op.page.id}`);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New page">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="page-name">Name</label>
          <input id="page-name" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Orders" maxLength={80} autoFocus />
        </div>
        <fieldset>
          <legend className="label">Start from</legend>
          <div className="grid grid-cols-2 gap-2">
            {PAGE_TEMPLATES.map((t) => (
              <label key={t.id} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${template === t.id ? "border-accent bg-accent-tint font-semibold text-accent" : "border-line hover:bg-ground"}`}>
                <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} className="sr-only" />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        {needsTable && <TablePicker value={table} onChange={setTable} />}
        {problem && <p className="text-sm text-red-700">{problem}</p>}
        <button className="btn-primary w-full">Add page</button>
      </form>
    </Dialog>
  );
}

export function AddBlockDialog({
  open,
  onClose,
  page,
  layout,
  blocks,
}: {
  open: boolean;
  onClose: () => void;
  page: Page;
  layout?: LayoutKey;
  /** Blocks of the layout being edited (new block goes below them). */
  blocks: Block[];
}) {
  const { blueprint, push } = useEdit();
  const [type, setType] = useState<BlockType>("table");
  const [table, setTable] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const needsTable = ADDABLE_BLOCKS.find((b) => b.type === type)!.needsTable;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const op = newBlockOp(blueprint, page, blocks, type, table || undefined, layout);
    if (typeof op === "string") return setProblem(op);
    if (push(op)) {
      setProblem(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add a block">
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="label">Block</legend>
          <div className="grid grid-cols-3 gap-2">
            {ADDABLE_BLOCKS.map((b) => (
              <label key={b.type} className={`cursor-pointer rounded-xl border px-3 py-2 text-center text-sm ${type === b.type ? "border-accent bg-accent-tint font-semibold text-accent" : "border-line hover:bg-ground"}`}>
                <input type="radio" name="type" value={b.type} checked={type === b.type} onChange={() => setType(b.type)} className="sr-only" />
                {b.label}
              </label>
            ))}
          </div>
        </fieldset>
        {needsTable && <TablePicker value={table} onChange={setTable} />}
        {problem && <p className="text-sm text-red-700">{problem}</p>}
        <button className="btn-primary w-full">Add block</button>
      </form>
    </Dialog>
  );
}
