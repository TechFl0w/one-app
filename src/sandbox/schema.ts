import { isComputedField, type Blueprint } from "@/schema/blueprint";
import type { SandboxSchema } from "./protocol";

/** What a generated component sees of the business: names, tables, fields, options (no code, no automations). */
export function sandboxSchema(bp: Blueprint): SandboxSchema {
  return {
    business: { name: bp.business.name, timezone: bp.business.timezone, currency: bp.business.currency ?? "CAD" },
    tables: bp.tables.map((t) => ({
      id: t.id,
      label: t.label,
      primaryField: t.primaryField,
      fields: t.fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        ...("required" in f && f.required ? { required: true } : {}),
        ...(isComputedField(f) ? { computed: true } : {}),
        ...("options" in f ? { options: f.options.map((o) => ({ id: o.id, label: o.label, ...(o.color ? { color: o.color } : {}) })) } : {}),
        ...(f.type === "link" ? { to: f.to } : {}),
      })),
    })),
  };
}

/** A page that is one full-width generated component is shown edge to edge, sized to its content. */
export const isFullPageComponent = (blocks: { type: string; w: number }[]) => blocks.length === 1 && blocks[0].type === "custom" && blocks[0].w === 12;
