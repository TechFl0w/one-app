"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { useEdit } from "@/components/edit/EditProvider";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { RecordDialog, type RecordFormRequest } from "@/components/sandbox/RecordDialog";
import { sandboxSchema } from "@/sandbox/schema";
import { opensAsPage, recordPath } from "@/engine/recordPage";
import { filesSupported } from "@/components/sandbox/files";
import { MediaGallery, MediaUploader } from "@/components/media/Media";

/**
 * The record pop-up for standard blocks: click a row to edit or delete it, "Add" to create one.
 * Same form as generated screens use (openRecordForm), so every table works the same way.
 */
type Opener = { go: (table: string, recordId: string) => void; form: (r: RecordFormRequest) => void };
const Ctx = createContext<Opener | null>(null);

export function RecordOpenerProvider({ children }: { children: React.ReactNode }) {
  const sandbox = useSandbox();
  const { blueprint } = useEdit();
  const router = useRouter();
  const [request, setRequest] = useState<RecordFormRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (!sandbox) return <>{children}</>;
  // A record opens its own page (everything about it in one place); small things open a pop-up.
  const opener: Opener = {
    go: (table, recordId) => (opensAsPage(blueprint, table) ? router.push(recordPath(sandbox.basePath, table, recordId)) : setRequest({ table, recordId })),
    form: setRequest,
  };
  return (
    <Ctx.Provider value={opener}>
      {children}
      <RecordDialog
        request={request}
        schema={sandboxSchema(blueprint)}
        bridge={sandbox.bridge}
        onDone={(saved, deleted) => {
          const editing = !!request?.recordId;
          const onItsPage = deleted && request?.recordId && typeof window !== "undefined" && window.location.pathname.endsWith(`/r/${request.table}/${request.recordId}`);
          setRequest(null);
          if (saved || deleted) {
            setToast(deleted ? "Deleted" : editing ? "Saved" : "Added");
            setTimeout(() => setToast(null), 3000);
            if (onItsPage) router.back();
            else router.refresh();
          }
        }}
      />
      {toast && <p role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-soft">{toast}</p>}
    </Ctx.Provider>
  );
}

/** A table row that opens its record. */
export function RecordRowLink({ table, recordId, children }: { table: string; recordId: string; children: React.ReactNode }) {
  const open = useContext(Ctx);
  if (!open) return <tr className="hover:bg-ground/60">{children}</tr>;
  return (
    <tr
      className="cursor-pointer hover:bg-ground/60 focus-visible:bg-ground/60 focus-visible:outline-none"
      tabIndex={0}
      onClick={() => open.go(table, recordId)}
      onKeyDown={(e) => e.key === "Enter" && open.go(table, recordId)}
    >
      {children}
    </tr>
  );
}

/** "Add" for a block's table (on a record page, prefilled with the link to that record). */
export function AddRecordButton({ table, label, defaults, big }: { table: string; label: string; defaults?: Record<string, unknown>; big?: boolean }) {
  const open = useContext(Ctx);
  if (!open) return null;
  if (big)
    return (
      <button type="button" className="btn-primary" onClick={() => open.form({ table })}>
        <Plus className="h-4 w-4" /> New {label}
      </button>
    );
  return (
    <button type="button" className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent-tint" onClick={() => open.form({ table, ...(defaults && Object.keys(defaults).length ? { defaults } : {}) })} aria-label={`Add ${label}`}>
      <Plus className="h-3.5 w-3.5" /> Add
    </button>
  );
}

/** Any list item, card or calendar entry that opens its record (rendered as the given element). */
export function OpenRecord({
  table,
  recordId,
  as: Tag = "div",
  className = "",
  style,
  title,
  children,
}: {
  table: string;
  recordId: string;
  as?: "li" | "article" | "div";
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const open = useContext(Ctx);
  if (!open) return <Tag className={className} style={style} title={title}>{children}</Tag>;
  return (
    <Tag
      className={`${className} cursor-pointer focus-visible:outline-2 focus-visible:outline-accent`}
      style={style}
      title={title}
      role="button"
      tabIndex={0}
      onClick={() => open.go(table, recordId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open.go(table, recordId);
        }
      }}
    >
      {children}
    </Tag>
  );
}

/** Edit (and delete) the record a record page is about. */
export function EditRecordButton({ table, recordId }: { table: string; recordId: string }) {
  const open = useContext(Ctx);
  if (!open) return null;
  return (
    <button type="button" className="btn-ghost shrink-0 px-3 py-1.5 text-sm" onClick={() => open.form({ table, recordId })}>
      <Pencil className="h-3.5 w-3.5" /> Edit
    </button>
  );
}

/**
 * A file field on a record page: its photos and videos, with adding right there — drop, paste or
 * tap, no edit form. Each change saves straight away.
 */
export function RecordFile({ table, recordId, field, file, label, multiple }: { table: string; recordId: string; field: string; file: unknown; label: string; multiple?: boolean }) {
  const sandbox = useSandbox();
  const router = useRouter();
  const [local, setLocal] = useState<{ from: unknown; value: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What we just saved, until the page brings the record back with it.
  const value = local && local.from === file ? local.value : file;
  const setValue = (v: unknown) => setLocal({ from: file, value: v });
  if (!sandbox) return null;
  if (!filesSupported(sandbox.bridge)) return <MediaGallery value={value} bridge={sandbox.bridge} label={label} size={multiple ? "h-28 w-28" : "h-40 w-56"} />;
  const save = async (v: unknown) => {
    setValue(v);
    setError(null);
    const r = await sandbox.bridge.update(table, recordId, { [field]: v });
    if (!r.ok) setError(r.error);
    else router.refresh();
  };
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      <MediaUploader bridge={sandbox.bridge} table={table} field={field} value={value} multiple={multiple} onChange={(v) => void save(v)} />
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
