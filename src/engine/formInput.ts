import type { Field } from "@/schema/blueprint";
import { localDateTimeToIso } from "./dates";

/**
 * Turns HTML form values (always strings) into typed record input keyed by field id.
 * Type/option checks still happen in validateRecordInput; this only converts shapes.
 */
export function formToInput(
  fields: Field[],
  form: { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] },
  timezone: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = form.get(f.id);
    const str = typeof raw === "string" ? raw.trim() : "";
    switch (f.type) {
      case "checkbox":
        out[f.id] = raw === "on" || raw === "true";
        break;
      case "number":
      case "money":
        out[f.id] = str === "" ? null : Number(str);
        break;
      case "datetime":
        out[f.id] = str === "" ? null : localDateTimeToIso(str, timezone) ?? str;
        break;
      case "choice":
      case "status":
      case "link":
        if (f.multiple) out[f.id] = form.getAll(f.id).filter((v): v is string => typeof v === "string" && v !== "");
        else out[f.id] = str === "" ? null : str;
        break;
      case "formula":
      case "rollup":
      case "file":
      case "person":
      case "hours":
        break; // not editable through simple forms
      default:
        out[f.id] = str === "" ? null : str;
    }
  }
  return out;
}

export { localDateTimeToIso } from "./dates";
