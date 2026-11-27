import { isComputedField, type Automation, type Blueprint, type Field, type Table } from "@/schema/blueprint";
import { resolveDateToken, tokenDays, valueMatches } from "@/engine/computed";
import { isoDate, localToday } from "@/engine/dates";

/**
 * Pure automation logic: which automations an event triggers, when date triggers are due,
 * whether conditions hold, and what each action would do. No I/O: the runner (runner.ts)
 * performs the effects through an AutomationEffects implementation.
 */

export interface RecordEvent {
  id: string;
  businessId: string;
  tableId: string;
  recordId: string;
  kind: "created" | "updated" | "deleted";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
  /** Automation hops behind this change (0 = a person; >0 = written by generated code run from an automation/webhook). */
  depth?: number;
}

/** Generated code started this many hops deep no longer triggers automations (no endless loops). */
export const MAX_CHAIN_DEPTH = 3;

// ---------- durations ----------

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

/** "-24h", "+21d", "30m", "1w" → milliseconds (signed). null if malformed. */
export function parseDuration(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^([+-])?\s*(\d{1,5})\s*([mhdw])$/.exec(s.trim());
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]) * UNIT_MS[m[3] as keyof typeof UNIT_MS];
}

// ---------- conditions ----------

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function compare(field: Field | undefined, a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (field?.type === "datetime") return Date.parse(String(a)) - Date.parse(String(b));
  if (field?.type === "number" || field?.type === "money" || typeof a === "number") {
    const x = Number(a);
    const y = Number(b);
    return Number.isNaN(x) || Number.isNaN(y) ? null : x - y;
  }
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Whether an automation's conditions hold for a record. Values may be "@today", "@now" or
 * "@today+30d" (business timezone). `skipComputed` ignores conditions on computed fields (when
 * only stored values are at hand); the runner always checks everything on the live record.
 */
export function conditionsHold(automation: Automation, table: Table, data: Record<string, unknown>, opts: { now?: Date; timezone?: string; skipComputed?: boolean } = {}): boolean {
  const now = opts.now ?? new Date();
  const today = isoDate(localToday(now, opts.timezone ?? "UTC"));
  return automation.conditions.every((cond) => {
    const field = table.fields.find((f) => f.id === cond.field);
    if (opts.skipComputed && field && isComputedField(field)) return true;
    // Day tokens on dates and date-times ("start eq @today") match by the business's local day.
    if (tokenDays(cond.value, today) && ["eq", "neq", "gt", "gte", "lt", "lte"].includes(cond.op)) return valueMatches(data[cond.field], cond as Parameters<typeof valueMatches>[1], today, now, opts.timezone ?? "UTC");
    const c = { ...cond, value: resolveDateToken(cond.value, today, now) as typeof cond.value };
    const v = data[c.field];
    switch (c.op) {
      case "empty":
        return isEmpty(v);
      case "not_empty":
        return !isEmpty(v);
      case "contains":
        return Array.isArray(v) ? v.includes(c.value) : typeof v === "string" && String(c.value ?? "").length > 0 && v.toLowerCase().includes(String(c.value).toLowerCase());
      case "eq":
        return Array.isArray(v) ? v.includes(c.value) : compare(field, v, c.value) === 0;
      case "neq":
        return !(Array.isArray(v) ? v.includes(c.value) : compare(field, v, c.value) === 0);
      default: {
        const r = compare(field, v, c.value);
        if (r === null) return false;
        return c.op === "gt" ? r > 0 : c.op === "gte" ? r >= 0 : c.op === "lt" ? r < 0 : r <= 0;
      }
    }
  });
}

// ---------- matching ----------

/** Trigger types the engine runs today. Others are accepted in blueprints but never fire yet. */
export const SUPPORTED_TRIGGERS = ["record_created", "record_updated", "status_changed", "date_reached"] as const;

const changed = (e: RecordEvent, fieldId: string) =>
  JSON.stringify(e.before?.[fieldId] ?? null) !== JSON.stringify(e.after?.[fieldId] ?? null);

/** Automations an event triggers right away (date triggers are handled by dueDateJobs). */
export function matchEvent(bp: Blueprint, e: RecordEvent, now = new Date()): Automation[] {
  const table = bp.tables.find((t) => t.id === e.tableId);
  const after = e.after;
  if (!table || !after) return [];
  return bp.automations.filter((a) => {
    if (!a.enabled || a.trigger.table !== e.tableId) return false;
    let fires = false;
    switch (a.trigger.type) {
      case "record_created":
        fires = e.kind === "created";
        break;
      case "record_updated":
        fires = e.kind === "updated" && (a.trigger.field ? changed(e, a.trigger.field) : true);
        break;
      case "status_changed": {
        const statusFields = a.trigger.field ? [a.trigger.field] : table.fields.filter((f) => f.type === "status").map((f) => f.id);
        fires = e.kind === "updated" && statusFields.some((f) => changed(e, f));
        if (fires && a.trigger.to !== undefined) fires = statusFields.some((f) => after[f] === a.trigger.to);
        break;
      }
    }
    // Events carry stored values only; computed conditions are checked when the job runs.
    return fires && conditionsHold(a, table, after, { now, timezone: bp.business.timezone, skipComputed: true });
  });
}

/** When a date_reached automation is due for a record, or null (no date / bad offset). */
export function dueAt(a: Automation, data: Record<string, unknown>): Date | null {
  if (a.trigger.type !== "date_reached" || !a.trigger.field) return null;
  const raw = data[a.trigger.field];
  if (typeof raw !== "string") return null;
  const base = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T09:00:00Z` : raw);
  if (Number.isNaN(base)) return null;
  const offset = a.trigger.offset === undefined ? 0 : parseDuration(a.trigger.offset);
  return offset === null ? null : new Date(base + offset);
}

/**
 * Idempotency key for a date trigger: includes the date value, so moving a booking schedules a
 * new run and the old one no longer matches.
 */
export const dateJobKey = (a: Automation, recordId: string, data: Record<string, unknown>) =>
  `${a.id}:${recordId}:${String(data[a.trigger.field ?? ""] ?? "")}`;
export const eventJobKey = (a: Automation, e: RecordEvent) => `${a.id}:event:${e.id}`;

// ---------- actions ----------

/**
 * Replaces {{fld_x}} (and {{fld_link.fld_y}}, {{record.id}}) in a message. `vars` holds the
 * readable values (automations/check.ts messageVars); without them the raw value is used.
 */
export function fillTemplate(s: string, recordId: string, data: Record<string, unknown>, vars: Record<string, string> = {}): string {
  return s.replace(/\{\{\s*(record\.id|fld_[a-z0-9_]+(?:\.fld_[a-z0-9_]+)?)\s*\}\}/g, (_, key: string) =>
    key === "record.id" ? recordId : key in vars ? vars[key] : data[key] === undefined || data[key] === null ? "" : String(data[key]),
  );
}

const fillValues = (values: unknown, recordId: string, data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(values && typeof values === "object" ? (values as Record<string, unknown>) : {}).map(([k, v]) => [
      k,
      typeof v === "string" ? fillTemplate(v, recordId, data) : v,
    ]),
  );

/** One planned step: what an action will do, already resolved against the record. */
export type Step =
  | { kind: "create_record"; table: string; values: Record<string, unknown> }
  | { kind: "update_record"; table: string; recordId: string; values: Record<string, unknown>; via?: string }
  | { kind: "notify"; message: string }
  | { kind: "send_message"; channel: string; toField?: string; template?: string; message?: string }
  | { kind: "wait"; ms: number }
  | { kind: "run_function"; function: string }
  | { kind: "unsupported"; type: string; reason: string };

export function planStep(action: Automation["actions"][number], ctx: { tableId: string; recordId: string; data: Record<string, unknown>; automation: Automation; vars?: Record<string, string> }): Step {
  const { tableId, recordId, data } = ctx;
  const vars = ctx.vars ?? {};
  switch (action.type) {
    case "create_record":
      return { kind: "create_record", table: typeof action.table === "string" ? action.table : tableId, values: fillValues(action.values, recordId, data) };
    case "update_record":
    case "assign":
      // With "via" (a link field), the linked record changes instead: a quote's job, a booking's client.
      return {
        kind: "update_record",
        table: tableId,
        recordId,
        values: fillValues(action.values ?? (action.field ? { [String(action.field)]: action.value } : {}), recordId, data),
        ...(typeof action.via === "string" ? { via: action.via } : {}),
      };
    case "notify":
      return { kind: "notify", message: fillTemplate(typeof action.message === "string" ? action.message : ctx.automation.label, recordId, data, vars) };
    case "send_message":
      return {
        kind: "send_message",
        // "auto": WhatsApp once connected, email until then.
        channel: typeof action.channel === "string" ? action.channel : "auto",
        toField: typeof action.to === "string" ? action.to : undefined,
        template: typeof action.template === "string" ? action.template : undefined,
        message: typeof action.message === "string" ? fillTemplate(action.message, recordId, data, vars) : undefined,
      };
    case "wait": {
      const ms = parseDuration(action.duration);
      return ms && ms > 0 ? { kind: "wait", ms } : { kind: "unsupported", type: "wait", reason: "Wait needs a duration like 2h or 1d" };
    }
    case "run_function":
      return typeof action.function === "string" ? { kind: "run_function", function: action.function } : { kind: "unsupported", type: "run_function", reason: "No function chosen" };
    default:
      return { kind: "unsupported", type: action.type, reason: "This step isn’t available yet" };
  }
}

/** Plain-language description of a step (test mode, run log). */
export function describeStep(bp: Blueprint, step: Step): string {
  const table = (id: string) => bp.tables.find((t) => t.id === id);
  const fields = (tableId: string, values: Record<string, unknown>) =>
    Object.entries(values)
      .map(([k, v]) => {
        const f = table(tableId)?.fields.find((x) => x.id === k);
        const shown = f && (f.type === "status" || f.type === "choice") ? (f.options.find((o) => o.id === v)?.label ?? v) : v;
        return `${f?.label ?? k} = ${JSON.stringify(shown)}`;
      })
      .join(", ");
  switch (step.kind) {
    case "create_record":
      return `Add a ${table(step.table)?.label.replace(/s$/, "").toLowerCase() ?? "record"} (${fields(step.table, step.values)})`;
    case "update_record": {
      if (step.via) {
        const link = table(step.table)?.fields.find((f) => f.id === step.via);
        const target = link?.type === "link" ? link.to : step.table;
        return `Set ${fields(target, step.values)} on the linked ${link?.label.toLowerCase() ?? "record"}`;
      }
      return `Set ${fields(step.table, step.values)}`;
    }
    case "notify":
      return `Notify you: “${step.message}”`;
    case "send_message": {
      const via = step.channel === "auto" ? "by WhatsApp or email" : step.channel === "email" ? "by email" : `by ${step.channel}`;
      const what = step.template ? `the ${TEMPLATE_NAMES[step.template] ?? step.template}` : "a message";
      return `Send ${what} ${via}`;
    }
    case "wait": {
      const [n, unit] = step.ms >= 86_400_000 ? [step.ms / 86_400_000, "day"] : step.ms >= 3_600_000 ? [step.ms / 3_600_000, "hour"] : [step.ms / 60_000, "minute"];
      return `Wait ${n} ${unit}${n === 1 ? "" : "s"}`;
    }
    case "run_function":
      return `Run ${bp.functions?.find((f) => f.id === step.function)?.label ?? step.function}`;
    case "unsupported":
      return `${step.type}: ${step.reason}`;
  }
}

const TEMPLATE_NAMES: Record<string, string> = {
  tpl_reminder: "appointment reminder",
  tpl_rebook: "time to rebook",
  tpl_review: "review request",
  tpl_thanks: "thank you",
  tpl_shipped: "order shipped",
  tpl_rent_due: "rent reminder",
  tpl_doc_expiry: "document expiring",
};

// ---------- retries ----------

export const MAX_ATTEMPTS = 5;

/** Exponential backoff: 1 min, 4 min, 16 min, 64 min … */
export const retryDelayMs = (attempt: number) => 60_000 * 4 ** Math.max(0, attempt - 1);

/** "When a booking’s Status changes to Done" — plain words for a trigger. */
export function describeTrigger(bp: Blueprint, a: Automation): string {
  const table = bp.tables.find((t) => t.id === a.trigger.table);
  const thing = table ? table.label.replace(/s$/, "").toLowerCase() : "record";
  const field = table?.fields.find((f) => f.id === a.trigger.field);
  switch (a.trigger.type) {
    case "record_created":
      return `When a ${thing} is added`;
    case "record_updated":
      return field ? `When a ${thing}’s ${field.label} changes` : `When a ${thing} changes`;
    case "status_changed": {
      const to = field && "options" in field ? field.options.find((o) => o.id === a.trigger.to)?.label : undefined;
      return `When a ${thing}’s ${field?.label ?? "status"} changes${to ? ` to ${to}` : ""}`;
    }
    case "date_reached": {
      const ms = parseDuration(a.trigger.offset ?? "0m") ?? 0;
      const abs = Math.abs(ms);
      const span = abs === 0 ? "" : abs % 86_400_000 === 0 ? `${abs / 86_400_000} day${abs === 86_400_000 ? "" : "s"}` : abs % 3_600_000 === 0 ? `${abs / 3_600_000} hour${abs === 3_600_000 ? "" : "s"}` : `${abs / 60_000} minutes`;
      const label = field?.label ?? "date";
      return ms === 0 ? `When a ${thing}’s ${label} arrives` : `${span[0].toUpperCase()}${span.slice(1)} ${ms < 0 ? "before" : "after"} a ${thing}’s ${label}`;
    }
    default:
      return `When ${a.trigger.type.replace(/_/g, " ")} (not available yet)`;
  }
}

/** "Status is not Paid", "Ends is on or before 30 days from today" — plain words for a condition. */
export function describeCondition(bp: Blueprint, a: Automation, c: Automation["conditions"][number]): string {
  const table = bp.tables.find((t) => t.id === a.trigger.table);
  const f = table?.fields.find((x) => x.id === c.field);
  const label = f?.label ?? c.field;
  // A rollup of a status (a payment's lease status) uses that status's option labels.
  const source = f?.type === "rollup" ? (() => {
    const via = f.from ? undefined : table?.fields.find((x) => x.id === f.via);
    const target = bp.tables.find((t) => t.id === (f.from ?? (via?.type === "link" ? via.to : undefined)));
    return target?.fields.find((x) => x.id === f.field);
  })() : f;
  const val = (v: unknown) => {
    if (source && "options" in source) return source.options.find((o) => o.id === v)?.label ?? String(v);
    if (typeof v === "string" && v.startsWith("@today")) {
      const m = /^@today([+-])(\d+)d$/.exec(v);
      return m ? `${m[2]} days ${m[1] === "+" ? "from" : "before"} today` : "today";
    }
    if (v === "@now") return "now";
    if (typeof v === "boolean") return v ? "ticked" : "not ticked";
    return String(v);
  };
  if (f?.type === "checkbox" && c.op === "eq") return `${label} is ${val(c.value)}`;
  const ops: Record<string, string> = { eq: "is", neq: "is not", gt: "is after", gte: "is on or after", lt: "is before", lte: "is on or before", contains: "contains", empty: "is empty", not_empty: "is filled in" };
  const isDate = f?.type === "date" || f?.type === "datetime";
  const word = !isDate && ["gt", "gte", "lt", "lte"].includes(c.op) ? { gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most" }[c.op as "gt"] : ops[c.op];
  return c.op === "empty" || c.op === "not_empty" ? `${label} ${word}` : `${label} ${word} ${val(c.value)}`;
}
