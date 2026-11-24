import type { Field } from "@/schema/blueprint";
import { startOfLocalDay } from "./dates";

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
        break; // not editable through simple forms
      default:
        out[f.id] = str === "" ? null : str;
    }
  }
  return out;
}

/** "2026-12-01T09:30" (wall clock in `tz`, from <input type="datetime-local">) → ISO instant. */
export function localDateTimeToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Midnight + wall-clock minutes, then re-check the offset at that instant (DST days).
  const midnight = startOfLocalDay({ year: y, month: mo, day: d }, tz);
  const guess = new Date(midnight.getTime() + (h * 60 + mi) * 60_000);
  const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess)
    .reduce((acc, p) => (p.type === "hour" ? acc + Number(p.value) * 60 : p.type === "minute" ? acc + Number(p.value) : acc), 0);
  const drift = local - (h * 60 + mi);
  return new Date(guess.getTime() - (((drift % 1440) + 1440 + 720) % 1440 - 720) * 60_000).toISOString();
}
