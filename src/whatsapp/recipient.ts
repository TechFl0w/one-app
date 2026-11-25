import type { Blueprint } from "@/schema/blueprint";
import { toE164 } from "./core";

/**
 * The WhatsApp number an automation message goes to: a phone field on the record, or on the
 * linked record (client, customer, renter). Mirrors resolveRecipient for email.
 */
export async function resolvePhone(
  bp: Blueprint,
  tableId: string,
  data: Record<string, unknown>,
  toField: string | undefined,
  getRecord: (tableId: string, id: string) => Promise<Record<string, unknown> | null>,
): Promise<{ phone: string; name?: string } | null> {
  const table = bp.tables.find((t) => t.id === tableId);
  if (!table) return null;
  const nameOf = (t: typeof table, d: Record<string, unknown>) => {
    const f = t.fields.find((x) => x.id === t.primaryField) ?? t.fields.find((x) => x.type === "text");
    return f && typeof d[f.id] === "string" ? (d[f.id] as string) : undefined;
  };
  const fields = toField ? table.fields.filter((f) => f.id === toField) : table.fields.filter((f) => f.type === "phone" || f.type === "link");
  for (const f of fields) {
    if (f.type === "phone") {
      const phone = toE164(String(data[f.id] ?? ""));
      if (phone) return { phone, name: nameOf(table, data) };
    }
    if (f.type === "link" && typeof data[f.id] === "string") {
      const target = bp.tables.find((t) => t.id === f.to);
      const linked = target && (await getRecord(target.id, data[f.id] as string));
      if (!target || !linked) continue;
      for (const pf of target.fields.filter((x) => x.type === "phone")) {
        const phone = toE164(String(linked[pf.id] ?? ""));
        if (phone) return { phone, name: nameOf(target, linked) };
      }
    }
  }
  return null;
}
