"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { Dialog } from "@/components/edit/Dialog";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Invoice work" on a client's page: every finished, unbilled visit in a month on one invoice. */
export function InvoiceWork({ table, client, label }: { table: string; client: string; label: string }) {
  const sandbox = useSandbox();
  const router = useRouter();
  const now = new Date();
  // Last month by default (invoicing usually happens at the start of the next one).
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - (now.getDate() <= 10 ? 1 : 0), 1);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(iso(lastMonth));
  const [to, setTo] = useState(iso(new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = sandbox?.bridge.invoiceWork;
  if (!run) return null;
  const go = () =>
    start(async () => {
      setMsg(null);
      const r = await run(table, client, from, to);
      if (!r.ok) return setMsg(r.error);
      if (!r.value.count || !r.value.id) return setMsg("Nothing to invoice: no finished, unbilled work in those dates.");
      router.push(`${sandbox.basePath}/r/${r.value.table}/${r.value.id}`);
    });
  return (
    <>
      <button type="button" className="btn-ghost ml-auto px-4 py-1.5 text-sm" onClick={() => setOpen(true)}>
        <ReceiptText className="h-4 w-4" /> Invoice work
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Invoice ${label}’s work`}>
        <div className="grid gap-4">
          <p className="text-sm text-muted">Every finished visit in these dates that isn’t on an invoice yet goes on one draft invoice.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">From<input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-sm">To<input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          {msg && <p className="rounded-xl bg-ground px-3 py-2 text-sm">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={pending} onClick={go}>{pending ? "Making it…" : "Make invoice"}</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
