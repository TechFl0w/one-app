"use client";

import { useState, useTransition } from "react";
import { decide } from "./actions";

type Input = Omit<Parameters<typeof decide>[0], "status">;

/** Buttons on a pattern: tell the builder, build it into the template (fields), or ignore. */
export function Decide({ input, status }: { input: Input; status?: "advice" | "template" | "dismissed" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (s: "advice" | "template" | "dismissed" | "undecided") =>
    start(async () => {
      setError(null);
      const r = await decide({ ...input, status: s });
      if (!r.ok) setError(r.error);
    });
  if (status)
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${status === "dismissed" ? "bg-ground text-muted" : "bg-accent-tint text-accent"}`}>
          {status === "advice" ? "Builder advises it" : status === "template" ? "In the template" : "Ignored"}
        </span>
        <button type="button" className="text-muted underline" disabled={pending} onClick={() => go("undecided")}>Undo</button>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button type="button" disabled={pending} onClick={() => go("advice")} className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent hover:bg-accent-tint">Teach the builder</button>
      {input.kind === "field" && (
        <button type="button" disabled={pending} onClick={() => go("template")} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">Add to template</button>
      )}
      <button type="button" disabled={pending} onClick={() => go("dismissed")} className="rounded-full px-2 py-1 text-xs text-muted hover:text-ink">Ignore</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
