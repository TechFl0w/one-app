"use client";

import { Select } from "@/components/ui/Select";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, FlaskConical, Zap } from "lucide-react";
import { describeStep, describeTrigger, planStep } from "@/automations/engine";
import { testAutomation } from "@/automations/runner";
import { applyChangeSet } from "@/engine/changeSet";
import { useEdit, type EditMode } from "@/components/edit/EditProvider";
import { Dialog } from "@/components/edit/Dialog";
import { saveBlueprintChanges } from "@/app/b/[businessId]/actions";
import type { Automation } from "@/schema/blueprint";

export interface RunRow {
  id: number;
  automation_id: string;
  status: "done" | "waiting" | "retrying" | "failed" | "skipped";
  test: boolean;
  steps: { description: string; outcome: string; note?: string }[];
  error: string | null;
  at: string;
}

export type Samples = Record<string, { id: string; label: string; data: Record<string, unknown> }[]>;

const STATUS_STYLE: Record<RunRow["status"], string> = {
  done: "bg-accent-tint text-accent",
  waiting: "bg-blue-50 text-blue-800",
  retrying: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-800",
  skipped: "bg-ground text-muted",
};

/** Automations: what starts them, what they do, on/off, recent runs, and a dry-run test. */
export function AutomationsView({ mode, runs, samples }: { mode: EditMode; runs: RunRow[]; samples: Samples }) {
  const { blueprint, adoptBlueprint } = useEdit();
  const router = useRouter();
  const [confirming, setConfirming] = useState<Automation | null>(null);
  const [testing, setTesting] = useState<Automation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const toggle = (a: Automation) =>
    startTransition(async () => {
      setError(null);
      const cs = { baseVersion: blueprint.version, source: "ui" as const, ops: [{ op: "toggleAutomation" as const, automationId: a.id, enabled: !a.enabled }] };
      if (mode.kind === "server") {
        const r = await saveBlueprintChanges(mode.businessId, cs, true);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } else {
        try {
          adoptBlueprint(applyChangeSet(blueprint, cs, { confirmed: true }).blueprint);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn’t change it.");
        }
      }
      setConfirming(null);
    });

  // Grouped by what they're about (bookings, invoices, pets), so dozens stay easy to scan.
  const areas = [...blueprint.automations.reduce((m, a) => {
    const area = blueprint.tables.find((t) => t.id === a.trigger.table)?.label ?? "General";
    return m.set(area, [...(m.get(area) ?? []), a]);
  }, new Map<string, Automation[]>())];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-center gap-3">
        <Zap className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Automations</h1>
      </div>
      <p className="mb-6 text-sm text-muted">Things that happen by themselves. Ask the assistant to add or change one.</p>
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">{error}</p>}

      {blueprint.automations.length === 0 && <div className="card p-10 text-center text-sm text-muted">No automations yet.</div>}
      {areas.map(([area, list], gi) => (
      <details key={area} open={blueprint.automations.length <= 6 || gi === 0} className="group mb-4">
        <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 rounded-xl px-1 py-1 text-sm font-bold uppercase tracking-wider text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          {area}
          <span className="rounded-full bg-card px-2 text-xs font-semibold normal-case tracking-normal">{list.length}</span>
        </summary>
      <ul className="space-y-4">
        {list.map((a) => {
          const mine = runs.filter((r) => r.automation_id === a.id).slice(0, 5);
          const table = blueprint.tables.find((t) => t.id === a.trigger.table);
          return (
            <li key={a.id} className="card p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{a.label}</h2>
                  <p className="text-sm text-muted">
                    {describeTrigger(blueprint, a)}
                    {a.guards?.includes("no_upcoming_booking") && ", if they haven’t booked again yet"}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.enabled}
                  aria-label={`${a.enabled ? "Turn off" : "Turn on"} ${a.label}`}
                  disabled={busy}
                  onClick={() => setConfirming(a)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${a.enabled ? "bg-accent" : "bg-line"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${a.enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              <ol className="mt-3 space-y-1 text-sm">
                {a.actions.map((act, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted">{i + 1}.</span>
                    {describeStep(blueprint, planStep(act, { tableId: table?.id ?? "", recordId: "…", data: {}, automation: a }))}
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setTesting(a)} disabled={!table}>
                  <FlaskConical className="h-4 w-4" /> Test
                </button>
                {mine.length === 0 ? (
                  <span className="text-xs text-muted">Hasn’t run yet.</span>
                ) : (
                  mine.map((r) => (
                    <span key={r.id} title={r.error ?? r.steps.map((s) => `${s.description}: ${s.outcome}${s.note ? ` (${s.note})` : ""}`).join("\n")} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                      {r.status} · {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  ))
                )}
              </div>
            </li>
          );
        })}
      </ul>
      </details>
      ))}

      <Dialog open={!!confirming} onClose={() => setConfirming(null)} title="Please confirm">
        <p className="mb-6 text-sm">
          {confirming?.enabled ? "Turn off" : "Turn on"} “{confirming?.label}”? {confirming?.enabled ? "It stops running until you turn it on again." : "It starts running for new events."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>Go back</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => confirming && toggle(confirming)}>
            Yes, turn {confirming?.enabled ? "off" : "on"}
          </button>
        </div>
      </Dialog>

      {testing && <TestDialog automation={testing} samples={samples[testing.trigger.table ?? ""] ?? []} onClose={() => setTesting(null)} />}
    </div>
  );
}

function TestDialog({ automation, samples, onClose }: { automation: Automation; samples: Samples[string]; onClose: () => void }) {
  const { blueprint } = useEdit();
  const [recordId, setRecordId] = useState(samples[0]?.id ?? "");
  const record = samples.find((s) => s.id === recordId);
  const result = record ? testAutomation(blueprint, automation, record) : null;
  return (
    <Dialog open onClose={onClose} title={`Test “${automation.label}”`}>
      {samples.length === 0 ? (
        <p className="text-sm text-muted">Add a record first, then test it here.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="test-record">Try it on</label>
            <Select id="test-record" value={recordId} onChange={(v) => setRecordId(v as string)} options={samples.map((s) => ({ value: s.id, label: s.label }))} />
          </div>
          {result && (
            <div className="rounded-2xl bg-ground p-4 text-sm">
              <p className="mb-2 font-semibold">{result.matches ? "It would run:" : "It wouldn’t run — the conditions don’t match this record."}</p>
              {result.dueAt && <p className="mb-2 text-muted">Due {new Date(result.dueAt).toLocaleString()}</p>}
              <ol className="list-decimal space-y-1 pl-5">{result.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <p className="mt-3 text-xs text-muted">Test mode: nothing is changed or sent.</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
