"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";

export interface ApprovalRow {
  id: string;
  items: string[];
  created_at: string;
}

/** Risky actions an AI app asked for; nothing happens until the owner approves. */
export function Approvals({ rows, resolve }: { rows: ApprovalRow[]; resolve: (id: string, approve: boolean) => Promise<{ ok: boolean; message?: string }> }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const act = (id: string, approve: boolean) =>
    start(async () => {
      const r = await resolve(id, approve);
      setDone((d) => ({ ...d, [id]: r.ok ? (approve ? "Done." : "Declined.") : `Couldn’t do it: ${r.message}` }));
    });

  if (!rows.length)
    return (
      <div className="card flex flex-col items-center gap-2 p-12 text-center text-sm text-muted">
        <ShieldCheck className="h-6 w-6" />
        Nothing waiting for you.
      </div>
    );
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="card space-y-3 p-5">
          <p className="text-xs text-muted">An AI app asked {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(r.created_at))}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {r.items.map((i, n) => <li key={n}>{i}</li>)}
          </ul>
          {done[r.id] ? (
            <p className="text-sm text-muted">{done[r.id]}</p>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => act(r.id, true)}>Approve</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => act(r.id, false)}>Decline</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
