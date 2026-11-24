import type { Blueprint, Field } from "@/schema/blueprint";

/** Turns raw audit rows into lines an owner can read ("Assistant changed Price on Gel manicure: $55 → $60"). */

export interface AuditRow {
  id: number;
  actor_id: string | null;
  source: "ui" | "ai" | "undo" | "system";
  action: string;
  table_id: string | null;
  record_id: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLine {
  id: number;
  who: string;
  what: string;
  changes: { field: string; before: string; after: string }[];
  at: string;
}

type Fmt = (field: Field, value: unknown) => string;
const plain: Fmt = (f, v) => {
  if (v === null || v === undefined || v === "") return "—";
  if ((f.type === "status" || f.type === "choice") && typeof v === "string") return f.options.find((o) => o.id === v)?.label ?? v;
  if (f.type === "checkbox") return v ? "yes" : "no";
  if (typeof v === "object") return "…";
  return String(v);
};

export function auditLine(bp: Blueprint, row: AuditRow, me: string | undefined, fmt: Fmt = plain): AuditLine {
  const who =
    row.source === "ai" ? "Assistant" : row.actor_id && row.actor_id === me ? "You" : row.actor_id ? "A team member" : row.source === "ui" ? "Online booking" : "Automation";
  const table = bp.tables.find((t) => t.id === row.table_id);
  const thing = table?.label.replace(/s$/, "").toLowerCase() ?? "record";
  const data = (row.details?.after ?? row.details?.before ?? {}) as Record<string, unknown>;
  const primary = table && (table.fields.find((f) => f.id === table.primaryField) ?? table.fields.find((f) => f.type === "text"));
  const name = primary && typeof data[primary.id] === "string" ? ` “${data[primary.id]}”` : "";

  let what: string;
  const changes: AuditLine["changes"] = [];
  switch (row.action) {
    case "record.created":
      what = `added ${thing}${name}`;
      break;
    case "record.deleted":
      what = `deleted ${thing}${name}`;
      break;
    case "record.updated": {
      what = `changed a ${thing}`;
      const c = (row.details?.changes ?? {}) as Record<string, { before: unknown; after: unknown }>;
      for (const [fieldId, v] of Object.entries(c)) {
        const field = table?.fields.find((f) => f.id === fieldId);
        if (!field) continue; // fields since removed from the setup
        changes.push({ field: field.label, before: fmt(field, v.before), after: fmt(field, v.after) });
      }
      break;
    }
    case "setup.changed":
      what = `changed the setup${row.summary ? `: ${row.summary}` : ""}`;
      break;
    case "setup.undone":
      what = `undid a setup change${row.summary ? ` (${row.summary.replace(/^Undo: /, "")})` : ""}`;
      break;
    default:
      if (row.action.startsWith("confirmation.")) {
        const verb = { confirmed: "Confirmed", cancelled: "Cancelled", failed: "Tried but failed" }[row.action.slice(13)] ?? row.action.slice(13);
        return { id: row.id, who: "You", what: `${verb.toLowerCase()}: ${row.summary ?? "an assistant action"}`, changes, at: row.created_at };
      }
      what = row.action;
  }
  return { id: row.id, who, what, changes, at: row.created_at };
}
