import { Blueprint, GRID_COLUMNS, type Automation, type Block, type DataSource, type Field, type Page } from "@/schema/blueprint";
import { newId } from "@/engine/editing";

/** Small builders so templates read like a description of the business. */

export const text = (id: string, label: string, required = false): Field => ({ id, label, type: "text", ...(required ? { required } : {}) });
export const longText = (id: string, label: string): Field => ({ id, label, type: "long_text" });
export const num = (id: string, label: string): Field => ({ id, label, type: "number" });
export const money = (id: string, label: string, currency?: string): Field => ({ id, label, type: "money", ...(currency ? { currency } : {}) });
export const date = (id: string, label: string, required = false): Field => ({ id, label, type: "date", ...(required ? { required } : {}) });
export const datetime = (id: string, label: string, required = false): Field => ({ id, label, type: "datetime", ...(required ? { required } : {}) });
export const phone = (id: string, label = "Phone"): Field => ({ id, label, type: "phone" });
export const email = (id: string, label = "Email"): Field => ({ id, label, type: "email" });
export const check = (id: string, label: string): Field => ({ id, label, type: "checkbox" });
export const file = (id: string, label: string): Field => ({ id, label, type: "file" });
export const link = (id: string, label: string, to: string, opts: { required?: boolean; multiple?: boolean } = {}): Field => ({ id, label, type: "link", to, ...opts });

const GREEN = "#17694F";
const AMBER = "#B7791F";
const GREY = "#5E5B55";
const RED = "#B42318";
const BLUE = "#2B6CB0";
export const COLORS = { GREEN, AMBER, GREY, RED, BLUE };

/** Status field from [label, color?] pairs; option ids derive from labels. */
export function status(id: string, label: string, options: [string, string?][], kind: "status" | "choice" = "status"): Field {
  const taken = new Set<string>();
  return { id, label, type: kind, options: options.map(([l, color]) => ({ id: newId("opt", l, taken), label: l, ...(color ? { color } : {}) })) };
}
export const optId = (label: string) => newId("opt", label, new Set());

export const block = (
  id: string,
  type: Block["type"],
  at: [x: number, y: number, w: number, h: number],
  source?: DataSource,
  options?: Record<string, unknown>,
): Block => ({ id, type, x: at[0], y: at[1], w: at[2], h: at[3], ...(source ? { source } : {}), ...(options ? { options } : {}) });

export const page = (id: string, label: string, icon: string, menuOrder: number, blocks: Block[]): Page => ({
  id,
  label,
  icon,
  menuOrder,
  hidden: false,
  layout: { columns: GRID_COLUMNS, blocks },
});

export const automation = (a: Omit<Automation, "enabled" | "conditions"> & Partial<Pick<Automation, "enabled" | "conditions">>): Automation => ({
  enabled: true,
  conditions: [],
  ...a,
});

/** Final check: every template output must be a valid blueprint. */
export const finish = (bp: unknown) => Blueprint.parse(bp);
