import type { Blueprint, Field, Table } from "@/schema/blueprint";

/**
 * Learning from what owners change after their app was set up: every change set they (or the
 * assistant for them) applied becomes patterns like "added a VIN field to Vehicles" or "renamed
 * Jobs to Work orders". Counted per business type, by how many businesses did it — the signal for
 * improving templates and the builder's advice. Pure; no record data is ever looked at.
 */

export interface HistoryEntry {
  id: string;
  businessId: string;
  source: string;
  createdAt: string;
  undoes?: string | null;
  changeSet: { ops?: unknown[] };
  inverse: { ops?: unknown[] };
}

export type PatternKind = "field" | "table" | "page" | "block" | "rename" | "option" | "layout" | "component" | "automation" | "theme" | "remove";

export interface Pattern {
  key: string;
  kind: PatternKind;
  text: string;
  /** What a template could add (fields only, for now). */
  payload?: { tableLabel: string; field: Field };
}

export interface Insight extends Pattern {
  businessType: string;
  businesses: number;
  /** businesses / all businesses of the type (0–1). */
  share: number;
  byAssistant: number;
  lastAt: string;
}

type Op = Record<string, unknown> & { op: string };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const q = (s: string) => `“${s}”`;

/** Patterns in one applied change set (labels from the business's setup and the change's inverse). */
export function patternsOf(entry: HistoryEntry, bp: Blueprint): Pattern[] {
  const ops = (entry.changeSet.ops ?? []) as Op[];
  const inverse = (entry.inverse.ops ?? []) as Op[];
  const tables = new Map(bp.tables.map((t) => [t.id, t]));
  // Tables and fields that were removed are only described by the inverse (it adds them back).
  for (const inv of inverse) if (inv.op === "addTable") tables.set((inv.table as Table).id, inv.table as Table);
  const tableLabel = (id: unknown) => tables.get(String(id))?.label ?? String(id);
  const fieldLabel = (tableId: unknown, fieldId: unknown) => {
    const back = inverse.find((i) => i.op === "addField" && i.tableId === tableId && (i.field as Field).id === fieldId);
    return (back?.field as Field | undefined)?.label ?? tables.get(String(tableId))?.fields.find((f) => f.id === fieldId)?.label ?? String(fieldId);
  };
  const pageLabel = (id: unknown) => {
    const back = inverse.find((i) => i.op === "addPage" && (i.page as { id: string }).id === id);
    return ((back?.page as { label?: string } | undefined)?.label ?? bp.pages.find((p) => p.id === id)?.label ?? String(id)) as string;
  };
  const out: Pattern[] = [];
  const add = (p: Pattern) => !out.some((x) => x.key === p.key) && out.push(p);
  for (const op of ops) {
    switch (op.op) {
      case "addField": {
        const f = op.field as Field;
        const t = tableLabel(op.tableId);
        add({ key: `field+|${norm(t)}|${norm(f.label)}`, kind: "field", text: `Add ${q(f.label)} (${f.type}) to ${t}`, payload: { tableLabel: t, field: f } });
        break;
      }
      case "removeField": {
        const t = tableLabel(op.tableId);
        const l = fieldLabel(op.tableId, op.fieldId);
        add({ key: `field-|${norm(t)}|${norm(l)}`, kind: "remove", text: `Remove ${q(l)} from ${t}` });
        break;
      }
      case "updateField": {
        const f = op.field as Field;
        const before = (inverse.find((i) => i.op === "updateField" && (i.field as Field).id === f.id)?.field as Field | undefined) ?? tables.get(String(op.tableId))?.fields.find((x) => x.id === f.id);
        if ((f.type === "status" || f.type === "choice") && before && "options" in before) {
          const had = new Set(before.options.map((o) => norm(o.label)));
          for (const o of f.options) if (!had.has(norm(o.label))) add({ key: `option+|${norm(tableLabel(op.tableId))}|${norm(f.label)}|${norm(o.label)}`, kind: "option", text: `Add the option ${q(o.label)} to ${tableLabel(op.tableId)} › ${f.label}` });
        }
        break;
      }
      case "rename": {
        const target = op.target as { kind: string; tableId?: string; fieldId?: string; pageId?: string };
        const old = inverse.find((i) => i.op === "rename" && JSON.stringify(i.target) === JSON.stringify(target))?.label as string | undefined;
        if (!old || norm(old) === norm(String(op.label))) break;
        const where = target.kind === "field" ? ` on ${tableLabel(target.tableId)}` : "";
        add({ key: `rename|${target.kind}|${norm(old)}|${norm(String(op.label))}`, kind: "rename", text: `Rename the ${target.kind} ${q(old)} to ${q(String(op.label))}${where}` });
        break;
      }
      case "addTable": {
        const t = op.table as Table;
        add({ key: `table+|${norm(t.label)}`, kind: "table", text: `Add a table ${q(t.label)} (${t.fields.map((f) => f.label).slice(0, 6).join(", ")})` });
        break;
      }
      case "removeTable":
        add({ key: `table-|${norm(tableLabel(op.tableId))}`, kind: "remove", text: `Remove the table ${q(tableLabel(op.tableId))}` });
        break;
      case "addPage": {
        const p = op.page as { label: string; recordOf?: string };
        add({ key: `page+|${norm(p.label)}`, kind: "page", text: p.recordOf ? `Design the ${tableLabel(p.recordOf)} record page` : `Add a page ${q(p.label)}` });
        break;
      }
      case "removePage":
        add({ key: `page-|${norm(pageLabel(op.pageId))}`, kind: "remove", text: `Remove the page ${q(pageLabel(op.pageId))}` });
        break;
      case "addBlock": {
        const b = op.block as { type: string; source?: { table: string } };
        const t = b.source ? ` of ${tableLabel(b.source.table)}` : "";
        add({ key: `block+|${b.type}|${norm(t)}`, kind: "block", text: `Add a ${b.type}${t}` });
        break;
      }
      case "removeBlock": {
        const back = inverse.find((i) => i.op === "addBlock" && (i.block as { id: string }).id === op.blockId)?.block as { type: string; source?: { table: string } } | undefined;
        if (back) add({ key: `block-|${back.type}|${norm(back.source ? tableLabel(back.source.table) : "")}`, kind: "remove", text: `Remove a ${back.type}${back.source ? ` of ${tableLabel(back.source.table)}` : ""}` });
        break;
      }
      case "moveBlock":
      case "resizeBlock":
      case "setLayoutOverride":
      case "createLayoutOverride":
        add({ key: `layout|${norm(pageLabel(op.pageId))}`, kind: "layout", text: `Rearrange the ${pageLabel(op.pageId)} page` });
        break;
      case "putComponent": {
        const c = op.component as { label: string };
        add({ key: `component|${norm(c.label)}`, kind: "component", text: `Build a custom screen ${q(c.label)}` });
        break;
      }
      case "addAutomation": {
        const a = op.automation as { label: string };
        add({ key: `automation+|${norm(a.label)}`, kind: "automation", text: `Add the automation ${q(a.label)}` });
        break;
      }
      case "toggleAutomation":
        if (op.enabled === false) {
          const label = bp.automations.find((a) => a.id === op.automationId)?.label ?? String(op.automationId);
          add({ key: `automation-off|${norm(label)}`, kind: "remove", text: `Switch off ${q(label)}` });
        }
        break;
      case "setTheme":
        add({ key: "theme", kind: "theme", text: "Change the colours and fonts" });
        break;
    }
  }
  return out;
}

/**
 * Insights per business type: each pattern with how many businesses of that type made it.
 * Changes later undone don't count; neither do system changes (setup, migrations).
 */
export function insightsFrom(
  businesses: { id: string; type: string }[],
  history: HistoryEntry[],
  blueprints: Map<string, Blueprint>,
): Insight[] {
  const typeOf = new Map(businesses.map((b) => [b.id, b.type]));
  const perType = new Map<string, number>();
  for (const b of businesses) perType.set(b.type, (perType.get(b.type) ?? 0) + 1);
  const undone = new Set(history.map((h) => h.undoes).filter((x): x is string => !!x));
  const acc = new Map<string, Pattern & { businessType: string; who: Set<string>; ai: Set<string>; lastAt: string }>();
  for (const h of history) {
    if (h.source === "system" || h.source === "undo" || undone.has(h.id)) continue;
    const bp = blueprints.get(h.businessId);
    const type = typeOf.get(h.businessId);
    if (!bp || !type) continue;
    for (const p of patternsOf(h, bp)) {
      const k = `${type}::${p.key}`;
      const cur = acc.get(k) ?? { ...p, businessType: type, who: new Set<string>(), ai: new Set<string>(), lastAt: h.createdAt };
      cur.who.add(h.businessId);
      if (h.source === "ai") cur.ai.add(h.businessId);
      if (h.createdAt > cur.lastAt) cur.lastAt = h.createdAt;
      acc.set(k, cur);
    }
  }
  return [...acc.values()]
    .map(({ who, ai, ...p }) => ({ ...p, businesses: who.size, byAssistant: ai.size, share: who.size / (perType.get(p.businessType) ?? 1) }))
    .sort((a, b) => b.businesses - a.businesses || b.share - a.share || b.lastAt.localeCompare(a.lastAt));
}

/**
 * Approved field additions applied to a freshly built template: a field many owners added
 * to a table (matched by label) is there from the start. Skips anything that no longer fits.
 */
export function withLearnedFields(bp: Blueprint, additions: { tableLabel: string; field: Field }[]): Blueprint {
  const next = structuredClone(bp);
  for (const a of additions) {
    const t = next.tables.find((x) => norm(x.label) === norm(a.tableLabel));
    if (!t || t.fields.some((f) => norm(f.label) === norm(a.field.label) || f.id === a.field.id)) continue;
    // Only plain fields: links, rollups and formulas depend on the rest of the setup.
    if (["link", "rollup", "formula"].includes(a.field.type)) continue;
    t.fields.push(structuredClone(a.field));
  }
  return next;
}

/** Approved advice for the builder ("Mechanic shops often add …"), one line each. */
export function learnedAdvice(type: string, hints: string[]): string {
  if (!hints.length) return "";
  return [`What other ${type} businesses changed after setup (suggest these when they fit; don't add them unasked):`, ...hints.map((h) => `- ${h}`)].join("\n");
}
