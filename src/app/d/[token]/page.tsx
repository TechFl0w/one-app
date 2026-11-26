import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicDocument } from "@/server/documents";
import { DocumentView } from "@/components/documents/DocumentView";
import { formatMoney } from "@/components/blocks/format";
import { CustomerActions } from "./CustomerActions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** A quote or invoice a business sent: read it, accept it or pay it. No account needed. */
export default async function DocumentPage({ params, searchParams }: PageProps<"/d/[token]">) {
  const { token } = await params;
  const paid = !!(await searchParams).paid;
  const doc = await publicDocument(token, { viewed: true });
  if (!doc) notFound();
  const v = doc.view;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:py-12">
      {paid && v.state !== "paid" && <p className="no-print mb-4 rounded-2xl bg-[#E3F1EB] px-4 py-3 text-sm font-semibold text-[#17694F]">Thank you — your payment went through. It can take a moment to show here.</p>}
      <DocumentView doc={v} className="card p-6 md:p-10" />
      <div className="mt-6">
        <CustomerActions token={token} canAccept={v.canAccept} canPay={v.canPay} kind={v.kind} amount={formatMoney(v.balance ?? v.total, v.business.currency)} />
      </div>
    </main>
  );
}
