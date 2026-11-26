import "server-only";
import { cookies } from "next/headers";
import type { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { templateById } from "@/templates";
import { resolveSeed } from "@/templates/types";
import { demoBlueprint, demoRecords } from "./salon";

/**
 * Which demo the visitor is looking at: the nail salon (default) or a business type's template
 * with its sample data (/demo?type=mechanic — remembered in a cookie). Nothing is ever saved.
 */
export const DEMO_COOKIE = "demo_type";
export const DEMO_TYPES = ["salon", "mechanic", "contractor", "electrician"] as const;

const built = new Map<string, Blueprint>();
/** What the sample business is called in each demo. */
const DEMO_NAMES: Record<string, string> = { mechanic: "Northside Auto Repair", contractor: "Greenline Landscaping", electrician: "Brightwire Electric" };
/** Demos that are a template with particular answers (an electrician is the contractor template). */
const DEMO_TEMPLATES: Record<string, { template: string; answers: Record<string, string> }> = { electrician: { template: "contractor", answers: { trade: "electrical" } } };

function fromTemplate(id: string): { blueprint: Blueprint; records: RecordRow[] } | null {
  const alias = DEMO_TEMPLATES[id];
  const template = templateById(alias?.template ?? id);
  if (!template) return null;
  const { blueprint, seed } = template.build({ name: DEMO_NAMES[id] ?? template.label, timezone: "America/Vancouver" }, alias?.answers ?? {});
  if (!built.has(id)) built.set(id, blueprint);
  // Stable ids, so a record page link keeps working while the demo is browsed.
  const ids = new Map<string, string>();
  // Created over the last few days, oldest first, so timelines read naturally.
  const start = Date.now() - seed.length * 47 * 60_000;
  const records = seed.map((s, i): RecordRow => {
    const at = new Date(start + i * 47 * 60_000).toISOString();
    const recordId = `00000000-0000-4000-8000-${String(500000 + i).padStart(12, "0")}`;
    const data = resolveSeed(s.data, ids);
    if (s.ref) ids.set(s.ref, recordId);
    return { id: recordId, tableId: s.table, data, createdAt: at, updatedAt: at };
  });
  return { blueprint: built.get(id)!, records };
}

export async function currentDemo(): Promise<{ type: string; blueprint: Blueprint; records: RecordRow[] }> {
  const type = (await cookies()).get(DEMO_COOKIE)?.value;
  const t = type && type !== "salon" ? fromTemplate(type) : null;
  return t ? { type: type!, ...t } : { type: "salon", blueprint: demoBlueprint, records: demoRecords() };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
type InboxItem = { id: number; from_address: string; from_name: string; subject: string; text_body: string; received_at: string; read_at: string | null; forwarded_at: string | null };

/** Sample Inbox messages that fit the demo's business. */
export function demoInbox(type: string, businessName: string): { address: string; items: InboxItem[] } {
  const address = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}@in.buildingwaves.tech`;
  if (type === "mechanic")
    return {
      address,
      items: [
        { id: 3, from_address: "sam@example.com", from_name: "Sam Okafor", subject: "Brakes — any update?", text_body: "Hi, just checking if the Corolla will be ready today? I could pick it up after 5. Thanks, Sam", received_at: hoursAgo(1), read_at: null, forwarded_at: hoursAgo(1) },
        { id: 2, from_address: "dana@example.com", from_name: "Dana Ruiz", subject: "Re: your quote for the 60,000 km service", text_body: "Go ahead with the oil and the inspection, skip the cabin filter for now. Dana", received_at: hoursAgo(4), read_at: null, forwarded_at: hoursAgo(4) },
        { id: 1, from_address: "orders@coastautoparts.example", from_name: "Coast Auto Parts", subject: "Order CA-20391 dispatched", text_body: "4 × Brake pads (front set) BP-1123 are on the way, expected tomorrow before 10am.", received_at: hoursAgo(20), read_at: hoursAgo(18), forwarded_at: null },
      ],
    };
  if (type === "contractor" || type === "electrician")
    return {
      address,
      items: [
        { id: 3, from_address: "priya@example.com", from_name: "Priya Shah", subject: `Re: your quote Q-0001`, text_body: "Thanks for coming by! Could you add a second planter box by the gate? Otherwise looks great, I'll accept once that's in. Priya", received_at: hoursAgo(2), read_at: null, forwarded_at: hoursAgo(2) },
        { id: 2, from_address: "tom@example.com", from_name: "Tom Becker", subject: "Invoice INV-0001", text_body: "Sorry, missed this one — paying the rest this week.", received_at: hoursAgo(6), read_at: null, forwarded_at: hoursAgo(6) },
        { id: 1, from_address: "ana@example.com", from_name: "Ana Lima", subject: "Gate code", text_body: "The gate code changed to 2290. See you tomorrow!", received_at: hoursAgo(22), read_at: hoursAgo(20), forwarded_at: null },
      ],
    };
  return {
    address: "polished-nail-bar@in.buildingwaves.tech",
    items: [
      { id: 2, from_address: "elena@example.com", from_name: "Elena Rossi", subject: "Can I move my appointment?", text_body: "Hi! Could I come at 4 instead of 3:30 tomorrow? Thanks, Elena", received_at: hoursAgo(2), read_at: null, forwarded_at: hoursAgo(2) },
      { id: 1, from_address: "orders@supplier.example", from_name: "Nail Supply Co", subject: "Your order #4821 has shipped", text_body: "Your gel polish order is on its way. Tracking: 1Z999AA10123456784", received_at: hoursAgo(26), read_at: hoursAgo(20), forwarded_at: null },
    ],
  };
}
