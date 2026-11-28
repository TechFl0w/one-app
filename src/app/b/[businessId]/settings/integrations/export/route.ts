import { createClient } from "@/lib/supabase/server";
import { getCurrentBlueprint } from "@/server/blueprints";
import { listRecords } from "@/server/records";
import { invoicesCsv } from "@/engine/accountingExport";
import type { RecordRow } from "@/schema/records";

/** Sent invoices for a period, as CSV for an accountant, QuickBooks or Xero (?from=&to=). */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) return new Response("from and to must be dates", { status: 400 });
  const supabase = await createClient(); // the signed-in member; row-level security limits it to their business
  const bp = await getCurrentBlueprint(supabase, businessId).catch(() => null);
  const def = bp?.documents?.find((d) => d.kind === "invoice");
  if (!bp || !def) return new Response("No invoices here", { status: 404 });
  const all = async (table: string) => {
    const out: RecordRow[] = [];
    for (let offset = 0; offset < 20000; offset += 500) {
      const page = await listRecords(supabase, businessId, { table, limit: 500, offset }, bp);
      out.push(...page.records);
      if (page.records.length < 500) break;
    }
    return out;
  };
  const custField = bp.tables.find((t) => t.id === def.table)?.fields.find((f) => f.id === def.customer);
  const [invoices, lines, customers] = await Promise.all([all(def.table), all(def.lines.table), custField?.type === "link" ? all(custField.to) : Promise.resolve([])]);
  const csv = invoicesCsv(bp, invoices, lines, new Map(customers.map((c) => [c.id, c])), { from, to });
  return new Response(csv ?? "", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="invoices-${from}-to-${to}.csv"` } });
}
