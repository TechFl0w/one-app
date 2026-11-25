import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { pageVersions } from "@/server/blueprints";
import { formatDateTime } from "@/components/blocks/format";
import { RestoreButton } from "@/components/page/RestoreButton";
import { restorePageVersion } from "../../../actions";

const WHO: Record<string, string> = { ui: "You", ai: "Assistant", undo: "Undo", mcp: "Connected AI app", system: "System", function: "Background task", import: "Import" };

/** Earlier versions of one page, each with Restore. */
export default async function PageHistory({ params }: PageProps<"/b/[businessId]/p/[pageId]/history">) {
  const { businessId, pageId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const page = blueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  const versions = await pageVersions(supabase, businessId, pageId);
  const ctx = { timezone: blueprint.business.timezone };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/b/${businessId}/p/${pageId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to {page.label}
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <History className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">History of “{page.label}”</h1>
      </div>
      {versions.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">No changes to this page yet.</div>
      ) : (
        <ol className="card divide-y divide-line/70">
          {versions.map((v, i) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{v.summary || "Changed"}</p>
                <p className="text-xs text-muted">
                  {WHO[v.source] ?? v.source} · {formatDateTime(v.at, ctx)}
                  {i === 0 && " · current"}
                </p>
              </div>
              {/* "Before this change" = the version this change started from. */}
              <RestoreButton label="Restore to before this" action={restorePageVersion.bind(null, businessId, pageId, v.before)} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
