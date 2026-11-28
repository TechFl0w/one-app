"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, FileText, Send } from "lucide-react";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { recordPath } from "@/engine/recordPage";

/**
 * Above a quote or invoice: send it to the customer (email + link), copy or open the customer's
 * link, and turn an accepted quote into an invoice.
 */
export function DocumentActions({ table, recordId, kind, label, sent, canInvoice, invoice }: { table: string; recordId: string; kind: "quote" | "invoice"; label: string; sent: boolean; canInvoice: boolean; invoice?: { table: string; id: string } | null }) {
  const sandbox = useSandbox();
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const b = sandbox?.bridge;
  if (!sandbox || !b) return null;
  const demo = !b.sendDocument;
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMsg(null);
      try {
        await fn();
      } catch (e) {
        setMsg({ text: e instanceof Error ? e.message : "Something went wrong", bad: true });
      }
    });
  const fail = (r: { ok: false; error: string }) => setMsg({ text: r.error, bad: true });
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          run(async () => {
            if (demo) return setMsg({ text: `In your own app this emails the ${kind} to the customer with a link to ${kind === "quote" ? "accept" : "pay"} it.` });
            const r = await b.sendDocument!(table, recordId);
            if (!r.ok) return fail(r);
            setMsg({ text: r.value.emailed ? `Sent — the customer got an email with the link.` : `${r.value.reason ?? "Not emailed."} Link copied.` });
            if (!r.value.emailed) await navigator.clipboard?.writeText(r.value.link).catch(() => {});
            router.refresh();
          })
        }
      >
        <Send className="h-4 w-4" /> {sent ? `Send ${label.toLowerCase()} again` : `Send ${label.toLowerCase()}`}
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        onClick={() =>
          run(async () => {
            if (demo) return setMsg({ text: "In your own app this copies the customer’s link." });
            const r = await b.documentLink!(table, recordId);
            if (!r.ok) return fail(r);
            await navigator.clipboard?.writeText(r.value).catch(() => {});
            setMsg({ text: "Link copied — paste it in a text or WhatsApp." });
          })
        }
      >
        <Copy className="h-4 w-4" /> Copy link
      </button>
      {!demo && (
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await b.documentLink!(table, recordId);
              if (!r.ok) return fail(r);
              window.open(r.value, "_blank", "noopener");
            })
          }
        >
          <ExternalLink className="h-4 w-4" /> See it as the client does
        </button>
      )}
      {invoice && (
        <a href={recordPath(sandbox.basePath, invoice.table, invoice.id)} className="btn-ghost">
          <FileText className="h-4 w-4" /> Open the invoice
        </a>
      )}
      {canInvoice && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {[
            [undefined, invoice ? "Invoice the rest" : "Invoice full amount"],
            ...(invoice ? [] : [[50, "Invoice 50% deposit"], [25, "25% deposit"]]),
          ].map(([pct, text]) => (
            <button
              key={String(text)}
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  if (!b.invoiceFromQuote) return setMsg({ text: "In your own app this makes an invoice with the quote’s lines (or a deposit invoice)." });
                  const r = await b.invoiceFromQuote(table, recordId, pct as number | undefined);
                  if (!r.ok) return fail(r);
                  router.push(recordPath(sandbox.basePath, r.value.table, r.value.id));
                })
              }
            >
              <FileText className="h-4 w-4" /> {text}
            </button>
          ))}
        </span>
      )}
      {msg && (
        <p role="status" className={`w-full text-sm ${msg.bad ? "text-red-700" : "text-muted"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
