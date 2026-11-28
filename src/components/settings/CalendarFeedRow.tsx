"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** One person's private calendar link: subscribe in Google or Apple/Outlook, or copy it. */
export function CalendarFeedRow({ name, url, reset }: { name: string; url: string; reset: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const webcal = url.replace(/^https?:/, "webcal:");
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="min-w-0 flex-1 text-sm font-medium">{name}</span>
      <a className="btn-ghost px-3 py-1.5 text-xs" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer">Add to Google</a>
      <a className="btn-ghost px-3 py-1.5 text-xs" href={webcal}>Apple / Outlook</a>
      <button
        type="button"
        className="btn-ghost px-3 py-1.5 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
      </button>
      <form action={reset}>
        <button className="px-2 py-1.5 text-xs text-muted hover:text-ink hover:underline" title="Makes a new link; the old one stops working">New link</button>
      </form>
    </li>
  );
}
