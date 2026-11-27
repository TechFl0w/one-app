import type { DocView } from "@/engine/documents";
import { formatMoney } from "@/components/blocks/format";

const STATE: Record<DocView["state"], { label: string; color: string; tint: string }> = {
  draft: { label: "Draft", color: "#6E685D", tint: "#EFEBE3" },
  sent: { label: "Sent", color: "#2B6CB0", tint: "#EAF1FA" },
  accepted: { label: "Accepted", color: "#17694F", tint: "#E3F1EB" },
  declined: { label: "Declined", color: "#6E685D", tint: "#EFEBE3" },
  expired: { label: "Expired", color: "#8A5A0C", tint: "#FDF0D9" },
  paid: { label: "Paid", color: "#17694F", tint: "#E3F1EB" },
  overdue: { label: "Overdue", color: "#B42318", tint: "#FDE7E5" },
};

export const documentStateLabel = (s: DocView["state"]) => STATE[s];

function date(iso: string | undefined, tz: string) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "long", year: "numeric", timeZone: iso.length === 10 ? "UTC" : tz }).format(d);
}

/**
 * A quote or invoice as the customer sees it: letterhead, who it's for, the scope of work,
 * lines (grouped when they have groups), totals and the small print. Prints cleanly.
 */
export function DocumentView({ doc, className = "" }: { doc: DocView; className?: string }) {
  const money = (n: number) => formatMoney(n, doc.business.currency);
  const s = STATE[doc.state];
  const groups = [...new Set(doc.lines.map((l) => l.group ?? ""))];
  const showQty = doc.lines.some((l) => l.qty !== undefined && l.qty !== 1) || doc.lines.some((l) => l.unit);
  const dueLabel = doc.kind === "quote" ? "Valid until" : "Due";
  return (
    <article className={`doc-paper bg-white text-[#1F1B14] ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#E7E2D8] pb-6">
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1F1B14] text-lg font-extrabold text-[#F7F5F0]">
            {doc.business.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </div>
          <p className="mt-3 text-lg font-extrabold">{doc.business.name}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-extrabold tracking-tight">{doc.label}</p>
          {doc.number && <p className="mt-1 font-semibold text-[#6E685D]">{doc.number}</p>}
          <span className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold" style={{ background: s.tint, color: s.color }}>
            {s.label}
          </span>
        </div>
      </header>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#6E685D]">For</p>
          <p className="mt-1 font-bold">{doc.customer.name}</p>
          {doc.customer.address && <p className="whitespace-pre-line text-sm text-[#4A463F]">{doc.customer.address}</p>}
          {doc.customer.email && <p className="text-sm text-[#4A463F]">{doc.customer.email}</p>}
          {doc.customer.phone && <p className="text-sm text-[#4A463F]">{doc.customer.phone}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          <dt className="text-[#6E685D]">Date</dt>
          <dd className="text-right font-medium">{date(doc.issued, doc.business.timezone)}</dd>
          {doc.due && (
            <>
              <dt className="text-[#6E685D]">{dueLabel}</dt>
              <dd className="text-right font-medium" style={doc.state === "overdue" || doc.state === "expired" ? { color: s.color } : undefined}>{date(doc.due, doc.business.timezone)}</dd>
            </>
          )}
          {doc.extra.map((x) => (
            <span key={x.label} className="contents">
              <dt className="text-[#6E685D]">{x.label}</dt>
              <dd className="text-right font-medium">{x.value}</dd>
            </span>
          ))}
        </dl>
      </section>

      {(doc.title || doc.intro) && (
        <section className="rounded-2xl bg-[#FAF8F4] p-5">
          {doc.title && <h2 className="text-xl font-extrabold tracking-tight">{doc.title}</h2>}
          {doc.intro && (
            <>
              {doc.kind === "quote" && <p className="mt-2 text-xs font-bold uppercase tracking-wider text-[#6E685D]">Scope of work</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#4A463F]">{doc.intro}</p>
            </>
          )}
        </section>
      )}

      <section className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b-2 border-[#1F1B14] text-left text-xs uppercase tracking-wider text-[#6E685D]">
              <th scope="col" className="py-2 pr-3 font-bold">Description</th>
              {showQty && <th scope="col" className="py-2 pr-3 text-right font-bold">Qty</th>}
              {showQty && <th scope="col" className="py-2 pr-3 text-right font-bold">Price</th>}
              <th scope="col" className="py-2 text-right font-bold">Amount</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g}>
              {g && groups.length > 1 && (
                <tr>
                  <td colSpan={showQty ? 4 : 2} className="pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-[#17694F]">{g}</td>
                </tr>
              )}
              {doc.lines.filter((l) => (l.group ?? "") === g).map((l) => (
                <tr key={l.id} className="border-b border-[#EFEBE3] align-top">
                  <td className="py-2.5 pr-3">{l.description}</td>
                  {showQty && <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{l.qty ?? 1}{l.unit ? ` ${l.unit}` : ""}</td>}
                  {showQty && <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{l.price !== undefined ? money(l.price) : ""}</td>}
                  <td className="whitespace-nowrap py-2.5 text-right font-medium tabular-nums">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {!doc.lines.length && <p className="py-6 text-center text-sm text-[#6E685D]">No lines yet.</p>}
      </section>

      <section className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          {doc.totals.map((t) => (
            <div key={t.label} className={`flex justify-between gap-6 ${t.strong ? "border-t border-[#1F1B14] pt-2 text-base font-extrabold" : "text-[#4A463F]"}`}>
              <dt>{t.label}</dt>
              <dd className="tabular-nums">{t.value < 0 ? `− ${money(-t.value)}` : money(t.value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {doc.accepted && (
        <p className="mt-6 rounded-2xl bg-[#E3F1EB] px-4 py-3 text-sm font-semibold text-[#17694F]">
          Accepted{doc.accepted.by ? ` by ${doc.accepted.by}` : ""} on {date(doc.accepted.on, doc.business.timezone)}
        </p>
      )}
      {doc.declined && <p className="mt-6 rounded-2xl bg-[#EFEBE3] px-4 py-3 text-sm font-semibold text-[#4A463F]">Declined on {date(doc.declined.on, doc.business.timezone)}</p>}

      {doc.terms && (
        <footer className="mt-8 border-t border-[#E7E2D8] pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#6E685D]">Terms</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#6E685D]">{doc.terms}</p>
        </footer>
      )}
    </article>
  );
}
