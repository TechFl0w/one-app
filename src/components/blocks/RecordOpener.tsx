"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useEdit } from "@/components/edit/EditProvider";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { RecordDialog, type RecordFormRequest } from "@/components/sandbox/RecordDialog";
import { sandboxSchema } from "@/sandbox/schema";

/**
 * The record pop-up for standard blocks: click a row to edit or delete it, "Add" to create one.
 * Same form as generated screens use (openRecordForm), so every table works the same way.
 */
const Ctx = createContext<((r: RecordFormRequest) => void) | null>(null);

export function RecordOpenerProvider({ children }: { children: React.ReactNode }) {
  const sandbox = useSandbox();
  const { blueprint } = useEdit();
  const router = useRouter();
  const [request, setRequest] = useState<RecordFormRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (!sandbox) return <>{children}</>;
  return (
    <Ctx.Provider value={setRequest}>
      {children}
      <RecordDialog
        request={request}
        schema={sandboxSchema(blueprint)}
        bridge={sandbox.bridge}
        onDone={(saved, deleted) => {
          const editing = !!request?.recordId;
          setRequest(null);
          if (saved || deleted) {
            setToast(deleted ? "Deleted" : editing ? "Saved" : "Added");
            setTimeout(() => setToast(null), 3000);
            router.refresh();
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
      onClick={() => open({ table, recordId })}
      onKeyDown={(e) => e.key === "Enter" && open({ table, recordId })}
    >
      {children}
    </tr>
  );
}

/** "Add" for a block's table. */
export function AddRecordButton({ table, label }: { table: string; label: string }) {
  const open = useContext(Ctx);
  if (!open) return null;
  return (
    <button type="button" className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent-tint" onClick={() => open({ table })} aria-label={`Add ${label}`}>
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
      onClick={() => open({ table, recordId })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open({ table, recordId });
        }
      }}
    >
      {children}
    </Tag>
  );
}
