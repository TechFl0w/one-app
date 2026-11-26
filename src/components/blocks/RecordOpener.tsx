"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Pencil, Plus } from "lucide-react";
import { useEdit } from "@/components/edit/EditProvider";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { RecordDialog, type RecordFormRequest } from "@/components/sandbox/RecordDialog";
import { sandboxSchema } from "@/sandbox/schema";
import { opensAsPage, recordPath } from "@/engine/recordPage";
import { asFile, filesSupported, recordFileUrl } from "@/components/sandbox/files";
import { isImageFile } from "@/lib/files";

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
export function AddRecordButton({ table, label, defaults }: { table: string; label: string; defaults?: Record<string, unknown> }) {
  const open = useContext(Ctx);
  if (!open) return null;
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

/** A file field's value on a record page: the photo itself, or a chip that opens the file. */
export function RecordFile({ file, label }: { file: unknown; label: string }) {
  const sandbox = useSandbox();
  const f = asFile(file);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (f && sandbox && filesSupported(sandbox.bridge)) recordFileUrl(sandbox.bridge, f.path).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [f?.path, sandbox]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  if (isImageFile(f))
    return (
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line" title={label}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
          <img src={url} alt={label} className="h-40 w-56 object-cover" />
        ) : (
          <span className="block h-40 w-56 animate-pulse bg-ground" />
        )}
      </a>
    );
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-ground">
      <Paperclip className="h-4 w-4 text-muted" /> <span className="max-w-48 truncate">{f.name}</span>
    </a>
  );
}
