import { History } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { listAudit } from "@/server/audit";
import { auditLine } from "@/engine/auditText";
import { formatDateTime } from "@/components/blocks/format";
import { RestoreButton } from "@/components/page/RestoreButton";
import { undoSetupChange } from "../actions";

/** Who changed what: records, setup and assistant confirmations (owners/admins). */
export default async function ActivityPage({ params }: PageProps<"/b/[businessId]/activity">) {
  const { businessId } = await params;
  const { supabase, blueprint, userId } = await getBusinessContext(businessId);
  const rows = await listAudit(supabase, businessId);
  const lines = rows.map((r) => auditLine(blueprint, r, userId));
  const ctx = { timezone: blueprint.business.timezone };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <History className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
      </div>
      {lines.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">Nothing yet — or only owners and admins can see activity.</div>
      ) : (
        <ol className="card divide-y divide-line/70">
          {lines.map((l) => (
            <li key={l.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className={`font-semibold ${l.who === "Assistant" ? "text-accent" : ""}`}>{l.who}</span>
                <span className="min-w-0 flex-1">{l.what}</span>
                <time className="text-xs text-muted" dateTime={l.at}>{formatDateTime(l.at, ctx)}</time>
              </div>
              {l.historyId && (
                <div className="mt-1.5">
                  <RestoreButton label="Undo this change" question="Undo this change? Later changes stay as they are." action={undoSetupChange.bind(null, businessId, l.historyId)} />
                </div>
              )}
              {l.changes.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {l.changes.map((c, i) => (
                    <li key={i}>
                      {c.field}: <span className="line-through">{c.before}</span> → <span className="text-ink">{c.after}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
