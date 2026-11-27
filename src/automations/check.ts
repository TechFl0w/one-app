import type { Automation, Blueprint, Field, Table } from "@/schema/blueprint";
import { EMAIL_TEMPLATES } from "@/email/compose";

/**
 * Checks an automation's steps when it's saved, so a step One App can't carry out (a guessed
 * field name, a placeholder that doesn't exist, a message with nobody to send it to) is refused
 * with a clear reason instead of silently doing nothing later.
 */

const KNOWN_TEMPLATES = Object.keys(EMAIL_TEMPLATES);
/** Words the email itself fills in: the person's first name, the business, the appointment time… */
const MESSAGE_WORDS = ["name", "business", "business_name", "when", "tracking", "review_link", "booking_link", "document_link", "manage_link"];
const STEP_KEYS: Record<string, string[]> = {
  send_message: ["type", "channel", "to", "message", "template"],
  notify: ["type", "message", "to"],
  wait: ["type", "duration"],
  create_record: ["type", "table", "values"],
  update_record: ["type", "values", "field", "value", "via"],
  assign: ["type", "values", "field", "value"],
  run_function: ["type", "function"],
};

const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;

/** Who a message can go to: a field with an email/phone, or a link to a record that has one. */
function reachable(bp: Blueprint, table: Table, fieldId: string): string | null {
  const f = table.fields.find((x) => x.id === fieldId);
  if (!f) return `“to” is ${fieldId}, which isn't a field on ${table.label}`;
  if (f.type === "email" || f.type === "phone") return null;
  if (f.type === "link") {
    const target = bp.tables.find((t) => t.id === f.to);
    if (target?.fields.some((x) => x.type === "email" || x.type === "phone")) return null;
    return `“to” is ${f.label}, but ${target?.label ?? f.to} has no email or phone field`;
  }
  return `“to” must be an email or phone field, or a link to the person (${f.label} is a ${f.type} field)`;
}

/** Placeholders in a message: {{fld_x}}, {{fld_link.fld_y}} (a field of the linked record) or {{record.id}}. */
export function placeholderIssues(bp: Blueprint, table: Table, text: string): string[] {
  const out: string[] = [];
  for (const [, raw] of text.matchAll(PLACEHOLDER)) {
    if (raw === "record.id" || MESSAGE_WORDS.includes(raw)) continue;
    const [first, second, ...rest] = raw.split(".");
    const f = table.fields.find((x) => x.id === first);
    if (!f) {
      out.push(`{{${raw}}} isn't a field on ${table.label}${/^[a-z_]+$/i.test(raw) && !raw.startsWith("fld_") ? " — use field ids like {{fld_name}}" : ""}`);
      continue;
    }
    if (second === undefined) continue;
    const target = f.type === "link" ? bp.tables.find((t) => t.id === f.to) : undefined;
    if (!target || rest.length) out.push(`{{${raw}}}: only a link field can be followed, one step (like {{${first}.fld_name}})`);
    else if (!target.fields.some((x) => x.id === second)) out.push(`{{${raw}}}: ${second} isn't a field on ${target.label}`);
  }
  return out;
}

export function automationIssues(bp: Blueprint, a: Automation): string[] {
  const issues: string[] = [];
  const table = bp.tables.find((t) => t.id === a.trigger.table);
  if (a.trigger.table && !table) issues.push(`the trigger's table ${a.trigger.table} doesn't exist`);
  if (a.trigger.field && table && !table.fields.some((f) => f.id === a.trigger.field)) issues.push(`the trigger's field ${a.trigger.field} isn't on ${table.label}`);
  for (const c of a.conditions) if (table && !table.fields.some((f) => f.id === c.field)) issues.push(`condition on ${c.field}, which isn't on ${table.label}`);
  a.actions.forEach((step, i) => {
    const at = `step ${i + 1} (${step.type})`;
    const s = step as Record<string, unknown>;
    const allowed = STEP_KEYS[step.type];
    if (allowed) {
      const extra = Object.keys(s).filter((k) => !allowed.includes(k));
      if (extra.length) issues.push(`${at} doesn't use ${extra.map((k) => `“${k}”`).join(", ")} — it takes ${allowed.filter((k) => k !== "type").join(", ")}`);
    }
    const text = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : undefined);
    if (step.type === "send_message") {
      if (s.channel !== undefined && !["auto", "email", "whatsapp"].includes(String(s.channel))) issues.push(`${at}: channel must be auto, email or whatsapp`);
      if (typeof s.to !== "string") {
        // Without "to", the message goes to the record's own email/phone or its linked person.
        const someone = table?.fields.some((f) => f.type === "email" || f.type === "phone" || (f.type === "link" && bp.tables.find((t) => t.id === f.to)?.fields.some((x) => x.type === "email" || x.type === "phone")));
        if (table && !someone) issues.push(`${at}: nobody to send it to — ${table.label} has no email or phone, and no link to someone who has`);
      } else if (table) {
        const why = reachable(bp, table, s.to);
        if (why) issues.push(`${at}: ${why}`);
      }
      if (!text("message") && !text("template")) issues.push(`${at}: needs a “message” (or a template: ${KNOWN_TEMPLATES.join(", ")})`);
      if (text("template") && !KNOWN_TEMPLATES.includes(text("template")!)) issues.push(`${at}: unknown template ${text("template")} (${KNOWN_TEMPLATES.join(", ")})`);
    }
    if ((step.type === "send_message" || step.type === "notify") && text("message") && table) for (const p of placeholderIssues(bp, table, text("message")!)) issues.push(`${at}: ${p}`);
    if (step.type === "wait" && !/^\d+\s*(m|min|h|d|w)$/.test(String(s.duration ?? ""))) issues.push(`${at}: duration must look like 30m, 2h, 1d or 1w`);
    if (step.type === "create_record" && typeof s.table === "string" && !bp.tables.some((t) => t.id === s.table)) issues.push(`${at}: table ${s.table} doesn't exist`);
    let viaTable: Table | undefined;
    if (step.type === "update_record" && s.via !== undefined && table) {
      const link = table.fields.find((f) => f.id === s.via);
      if (!link || link.type !== "link") issues.push(`${at}: “via” must be a link field on ${table.label} (the record to change)`);
      else viaTable = bp.tables.find((t) => t.id === link.to);
    }
    if ((step.type === "update_record" || step.type === "create_record") && s.values && typeof s.values === "object") {
      const target = step.type === "create_record" ? bp.tables.find((t) => t.id === s.table) : viaTable ?? table;
      for (const k of Object.keys(s.values as object)) if (target && !target.fields.some((f) => f.id === k)) issues.push(`${at}: ${k} isn't a field on ${target.label}`);
    }
    if (step.type === "run_function" && !(bp.functions ?? []).some((f) => f.id === s.function)) issues.push(`${at}: server code ${String(s.function)} doesn't exist`);
  });
  return issues;
}

// ---------- readable values for messages ----------

/** A field's value as a person reads it in a message (dates in the business's time, money, option names). */
export function readable(f: Field | undefined, v: unknown, bp: Blueprint, labels: Record<string, string> = {}): string {
  if (v === null || v === undefined || v === "") return "";
  if (!f) return String(v);
  const tz = bp.business.timezone;
  switch (f.type) {
    case "datetime": {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
    }
    case "date": {
      const d = new Date(`${String(v).slice(0, 10)}T12:00:00Z`);
      return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
    }
    case "money":
      return typeof v === "number" ? new Intl.NumberFormat("en-CA", { style: "currency", currency: f.currency ?? bp.business.currency ?? "CAD", maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v) : String(v);
    case "status":
    case "choice":
      return (Array.isArray(v) ? v : [v]).map((x) => f.options.find((o) => o.id === x)?.label ?? String(x)).join(", ");
    case "checkbox":
      return v ? "yes" : "no";
    case "link":
      return (Array.isArray(v) ? v : [v]).map((x) => labels[String(x)] ?? "").filter(Boolean).join(", ");
    case "rollup":
    case "formula":
      return typeof v === "number" && f.format === "money" ? new Intl.NumberFormat("en-CA", { style: "currency", currency: bp.business.currency ?? "CAD" }).format(v) : String(v);
    default:
      return typeof v === "object" ? "" : String(v);
  }
}

/**
 * Every value a message can use, as text: {{fld_x}} readable, and {{fld_link.fld_y}} from the
 * linked record. Loads the linked records the message needs (one each).
 */
export async function messageVars(bp: Blueprint, tableId: string, data: Record<string, unknown>, texts: string[], load: (tableId: string, id: string) => Promise<Record<string, unknown> | null>): Promise<Record<string, string>> {
  const table = bp.tables.find((t) => t.id === tableId);
  if (!table) return {};
  const used = new Set(texts.flatMap((t) => [...t.matchAll(PLACEHOLDER)].map((m) => m[1])));
  const vars: Record<string, string> = {};
  const linked = new Map<string, Record<string, unknown> | null>();
  const get = async (f: Extract<Field, { type: "link" }>, id: string) => {
    if (!linked.has(id)) linked.set(id, await load(f.to, id).catch(() => null));
    return linked.get(id) ?? null;
  };
  const titleOf = (t: Table | undefined, d: Record<string, unknown> | null) => {
    const pf = t && (t.fields.find((x) => x.id === t.primaryField) ?? t.fields.find((x) => x.type === "text"));
    return pf && d ? String(d[pf.id] ?? "") : "";
  };
  for (const key of used) {
    const [first, second] = key.split(".");
    const f = table.fields.find((x) => x.id === first);
    if (!f) continue;
    if (f.type === "link") {
      const ids = (Array.isArray(data[f.id]) ? (data[f.id] as unknown[]) : [data[f.id]]).filter((x): x is string => typeof x === "string");
      const target = bp.tables.find((t) => t.id === f.to);
      const recs = await Promise.all(ids.map((id) => get(f, id)));
      vars[key] = second
        ? recs.map((r) => readable(target?.fields.find((x) => x.id === second), r?.[second], bp)).filter(Boolean).join(", ")
        : recs.map((r) => titleOf(target, r)).filter(Boolean).join(", ");
    } else if (!second) vars[key] = readable(f, data[f.id], bp);
  }
  return vars;
}
