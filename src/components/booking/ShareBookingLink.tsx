"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="btn-ghost shrink-0 px-3 py-2" onClick={copy}>
      {copied ? <Check className="h-4 w-4 text-accent" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** The public booking link with copy buttons for the link and a website embed snippet. */
export function ShareBookingLink({ url }: { url: string }) {
  const embed = `<iframe src="${url}" title="Book online" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <a className="min-w-0 flex-1 truncate font-medium text-accent underline" href={url} target="_blank" rel="noreferrer">{url}</a>
        <CopyButton text={url} label="Copy link" />
      </div>
      <details className="rounded-xl border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Put it on your website</summary>
        <p className="mt-2 text-xs text-muted">Paste this where the booking form should appear (Wix, Squarespace and WordPress all have an “embed HTML” block).</p>
        <div className="mt-2 flex items-start gap-2">
          <code className="block min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-ground p-3 text-xs">{embed}</code>
          <CopyButton text={embed} label="Copy" />
        </div>
      </details>
    </div>
  );
}
