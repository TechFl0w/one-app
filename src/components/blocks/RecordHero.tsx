"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { CoverImage, useMediaViewer } from "@/components/media/Media";
import { asFiles } from "@/components/sandbox/files";
import { useSandbox } from "@/components/sandbox/SandboxProvider";

/** The big photo at the top of a record page; tap to see all its photos full screen. */
export function HeroPhoto({ value, label }: { value: unknown; label: string }) {
  const viewer = useMediaViewer();
  const bridge = useSandbox()?.bridge;
  const files = asFiles(value);
  const img = <CoverImage value={value} label={label} className="h-44 w-full rounded-2xl sm:h-40 sm:w-60" />;
  if (!files.length) return <div className="shrink-0">{img}</div>;
  return (
    <button type="button" className="relative shrink-0 text-left" onClick={() => viewer?.open(files, 0, bridge)} aria-label={`Photos of ${label}`}>
      {img}
      {files.length > 1 && <span className="absolute bottom-2 left-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-semibold text-white">{files.length} photos</span>}
    </button>
  );
}

/**
 * Where a record is in its stages: done steps filled, the current one marked, the rest open.
 * Tap a step to move there, or the "→ next" button. Saves straight away (undo with a tap back).
 */
export function StageStepper({ table, recordId, field, label, value, steps }: { table: string; recordId: string; field: string; label: string; value: string | null; steps: { id: string; label: string; color: string }[] }) {
  const sandbox = useSandbox();
  const router = useRouter();
  const [state, setState] = useState<{ from: string | null; to: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = state && state.from === value ? state.to : value;
  const at = steps.findIndex((s) => s.id === current);
  const next = at >= 0 && at < steps.length - 1 ? steps[at + 1] : at < 0 ? steps[0] : undefined;
  const go = async (to: string) => {
    if (!sandbox || to === current) return;
    setError(null);
    setState({ from: value, to });
    const r = await sandbox.bridge.update(table, recordId, { [field]: to });
    if (!r.ok) {
      setState(null);
      setError(r.error);
      return;
    }
    router.refresh();
  };
  const color = at >= 0 ? steps[at].color : "var(--accent)";
  return (
    <div className="mt-4">
      <ol aria-label={label} className="flex gap-1">
        {steps.map((s, i) => {
          const done = i < at;
          const here = i === at;
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button type="button" disabled={!sandbox} onClick={() => void go(s.id)} className="group block w-full text-left" aria-current={here ? "step" : undefined} title={`${label}: ${s.label}`}>
                <span className="block h-2 rounded-full transition-colors" style={{ background: done || here ? color : "var(--line)", opacity: done ? 0.55 : 1 }} />
                <span className={`mt-1.5 hidden truncate text-[11px] md:block ${here ? "font-bold" : "text-muted group-hover:text-ink"}`} style={here ? { color } : undefined}>
                  {done && <Check className="mr-0.5 inline h-3 w-3" aria-hidden />}
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm md:hidden">
          <b style={{ color }}>{at >= 0 ? steps[at].label : "Not started"}</b>
          <span className="text-muted"> · step {Math.max(at + 1, 0)} of {steps.length}</span>
        </span>
        {next && sandbox && (
          <button type="button" className="btn-primary px-4 py-1.5 text-sm" style={{ background: next.color, borderColor: next.color }} onClick={() => void go(next.id)}>
            <ArrowRight className="h-4 w-4" /> {next.label}
          </button>
        )}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}
