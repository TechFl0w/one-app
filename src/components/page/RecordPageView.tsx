import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { Blueprint } from "@/schema/blueprint";
import type { Device } from "@/engine/layout";
import { recordLabel } from "@/engine/blockData";
import { listPageFor, recordPageFor } from "@/engine/recordPage";
import { parentFieldOf } from "@/engine/hierarchy";
import { InvoiceWork } from "@/components/documents/InvoiceWork";
import { BlockView, type BlockEnv } from "@/components/blocks/BlockView";
import { PageView } from "./PageView";
import { ROW_HEIGHT } from "./EditablePage";

/**
 * A record's own page: everything about one car, job or customer. The table's designed record
 * page when there is one (editable like any page), else the default: details + every list of
 * linked records.
 */
export async function RecordPageView({ tableId, recordId, device, userId, env }: { tableId: string; recordId: string; device: Device; userId?: string; env: BlockEnv & { blueprint: Blueprint } }) {
  const bp = env.blueprint;
  const table = bp.tables.find((t) => t.id === tableId);
  const found = recordPageFor(bp, tableId);
  const [record] = table ? await env.store.getMany(tableId, [recordId]) : [];
  const basePath = env.sandbox?.basePath ?? "";
  // Back to the page that lists this table best: a full list of it (no filters) beats a filtered one.
  const listPage = listPageFor(bp, tableId);
  // A record that belongs to another (a pet to its owner, a room to its building) leads with it.
  const parentF = table ? parentFieldOf(bp.tables, tableId) : undefined;
  const parentId = parentF && record ? record.data[parentF.id] : undefined;
  const parentTable = parentF && "to" in parentF ? bp.tables.find((t) => t.id === parentF.to) : undefined;
  const [parent] = parentTable && typeof parentId === "string" ? await env.store.getMany(parentTable.id, [parentId]) : [];
  // A client whose work is invoiced by period gets "Invoice work".
  const billing = bp.documents?.find((d) => d.kind === "invoice" && d.bill && bp.tables.find((t) => t.id === d.bill!.table)?.fields.some((f) => f.id === d.bill!.customer && f.type === "link" && f.to === tableId));
  const header = (
    <div className="mb-4 flex items-center gap-2 text-sm text-muted">
      {listPage ? (
        <Link href={`${basePath}/p/${listPage.id}`} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-card hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> {listPage.label}
        </Link>
      ) : (
        <span>{table?.label}</span>
      )}
      {parent && parentTable && (
        <Link href={`${basePath}/r/${parentTable.id}/${parent.id}`} className="truncate rounded-full px-2 py-1 hover:bg-card hover:text-ink">
          › {recordLabel(parentTable, parent)}
        </Link>
      )}
      {record && table && <span className="truncate">› {recordLabel(table, record)}</span>}
      {billing && record && table && <InvoiceWork table={billing.table} client={record.id} label={recordLabel(table, record)} />}
    </div>
  );
  if (!table || !found || !record) {
    return (
      <div className="mx-auto max-w-[1400px]">
        {header}
        <div className="card p-12 text-center text-muted">{table ? "This record was deleted or doesn’t exist." : "This table doesn’t exist (anymore)."}</div>
      </div>
    );
  }
  const scoped: BlockEnv = { ...env, recordId };
  if (found.designed) {
    return (
      <div>
        <div className="mx-auto max-w-[1400px]">{header}</div>
        <PageView page={found.page} device={device} userId={userId} env={scoped} />
      </div>
    );
  }
  // Default layout: details left, linked lists right (stacked on phones).
  const blocks = found.page.layout.blocks;
  return (
    <div className="mx-auto max-w-[1400px]">
      {header}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12" style={{ gridAutoRows: `${ROW_HEIGHT}px` }}>
        {blocks.map((b) => (
          <div key={b.id} className="min-h-0 md:[grid-column:var(--col)] md:[grid-row:var(--row)]" style={{ "--col": `${b.x + 1} / span ${b.w}`, "--row": `${b.y + 1} / span ${b.h}`, gridRow: `span ${b.h}` } as React.CSSProperties}>
            <BlockView block={b} env={scoped} />
          </div>
        ))}
      </div>
    </div>
  );
}
