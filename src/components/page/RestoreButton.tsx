"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Restores a page version after a quick confirm, then shows the result. */
export function RestoreButton({ label, action, question = "Put this page back the way it was before this change? You can undo it afterwards." }: { label: string; action: () => Promise<{ ok: boolean; message: string }>; question?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      {result && <span className={`text-xs ${result.ok ? "text-accent" : "text-red-700"}`}>{result.message}</span>}
      <button
        type="button"
        className="btn-ghost px-4 py-1.5 text-sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(question)) return;
          start(async () => {
            const r = await action();
            setResult(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? "Restoring…" : label}
      </button>
    </div>
  );
}
