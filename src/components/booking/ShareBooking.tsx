"use client";

import { useState } from "react";
import { CalendarCheck, Copy, ExternalLink, Share2 } from "lucide-react";
import { Dialog } from "@/components/edit/Dialog";

/**
 * The business's public booking page in the menu, with Share: the link, a QR code for the front
 * desk, and a snippet for their website or Instagram bio.
 */
export function ShareBooking({ url, qrSvg, business }: { url: string; qrSvg: string; business: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };
  const embed = `<a href="${url}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#17694F;color:#fff;font:600 15px system-ui;text-decoration:none">Book with ${business.replace(/[<>"]/g, "")}</a>`;
  return (
    <>
      <div className="flex items-center gap-1">
        <a href={url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
          <CalendarCheck className="h-4 w-4" /> Booking page
        </a>
        <button type="button" onClick={() => setOpen(true)} className="rounded-full p-2 text-muted hover:bg-ground hover:text-accent" aria-label="Share your booking page">
          <Share2 className="h-4 w-4" />
        </button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Share your booking page">
        <div className="grid gap-5">
          <p className="text-sm text-muted">Clients pick a service, who they’d like and a time — and pay the deposit if you take one. No account needed.</p>
          <div className="flex gap-2">
            <input readOnly value={url} className="input min-w-0 flex-1 text-sm" aria-label="Booking page link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-primary px-4" onClick={() => void copy("link", url)}>
              <Copy className="h-4 w-4" /> {copied === "link" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <div className="h-36 w-36 shrink-0 rounded-2xl border border-line bg-white p-2 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} role="img" aria-label="QR code for the booking page" />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p className="font-semibold">QR code for the front desk</p>
              <p className="text-muted">Print it or show it on a screen; phones open the booking page.</p>
              <a className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`} download="booking-qr.svg">
                Download the QR code
              </a>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">On your website or Instagram</p>
            <p className="text-sm text-muted">Put the link in your Instagram bio, or paste this button into your website:</p>
            <textarea readOnly value={embed} rows={3} className="input font-mono text-xs" aria-label="Button for your website" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-ghost px-4 py-1.5 text-sm" onClick={() => void copy("embed", embed)}>
              <Copy className="h-4 w-4" /> {copied === "embed" ? "Copied" : "Copy the button"}
            </button>
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            <ExternalLink className="h-4 w-4" /> Open it the way clients see it
          </a>
        </div>
      </Dialog>
    </>
  );
}
