"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSandbox } from "@/components/sandbox/SandboxProvider";

/**
 * One-tap buttons on a row that set a field ("Approve" / "Decline" a quote line). Shown while
 * the row's value is none of the buttons' values; afterwards the row shows the value itself.
 */
export function QuickSet({ table, recordId, field, buttons, current }: { table: string; recordId: string; field: string; buttons: { value: string; label: string; color?: string }[]; current: React.ReactNode }) {
  const sandbox = useSandbox();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!sandbox) return <>{current}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {buttons.map((b, i) => (
        <button
          key={b.value}
          type="button"
          disabled={!!saving}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={async (e) => {
            e.stopPropagation();
            e.preventDefault();
            setSaving(b.value);
            setError(null);
            const r = await sandbox.bridge.update(table, recordId, { [field]: b.value });
            setSaving(null);
            if (!r.ok) return setError(r.error);
            router.refresh();
          }}
          className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60"
          style={i === 0 ? { background: b.color ?? "var(--accent)", borderColor: b.color ?? "var(--accent)", color: "#fff" } : { borderColor: "var(--line)", background: "var(--card)" }}
        >
          {saving === b.value ? "…" : b.label}
        </button>
      ))}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
