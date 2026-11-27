"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** A private value (alarm code, lockbox): dots until tapped, hidden again on a second tap. */
export function Secret({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setShown((s) => !s);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-ground px-2 py-0.5 text-sm hover:text-ink"
      aria-label={shown ? "Hide" : "Show private value"}
    >
      {shown ? <EyeOff className="h-3.5 w-3.5 text-muted" /> : <Eye className="h-3.5 w-3.5 text-muted" />}
      <span className={shown ? "font-medium" : "tracking-widest text-muted"}>{shown ? text : "••••••"}</span>
    </button>
  );
}
