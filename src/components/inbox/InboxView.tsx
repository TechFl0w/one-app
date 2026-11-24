"use client";

import { useState, useTransition } from "react";
import { Inbox, Mail } from "lucide-react";

export interface InboxItem {
  id: number;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  text_body: string | null;
  received_at: string;
  read_at: string | null;
  forwarded_at: string | null;
}

/** The business's Inbox: emails sent to its inbound address. Opening one marks it read. */
export function InboxView({
  items: initial,
  inboundAddress,
  timezone,
  markRead,
}: {
  items: InboxItem[];
  inboundAddress: string;
  timezone: string;
  markRead?: (id: number) => Promise<void>;
}) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const open = items.find((i) => i.id === openId);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));

  const select = (id: number) => {
    setOpenId(id);
    const item = items.find((i) => i.id === id);
    if (item && !item.read_at) {
      setItems((list) => list.map((i) => (i.id === id ? { ...i, read_at: new Date().toISOString() } : i)));
      if (markRead) startTransition(() => markRead(id));
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-2 flex items-center gap-3">
        <Inbox className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
      </div>
      <p className="mb-6 text-sm text-muted">
        Emails to <span className="font-medium text-ink">{inboundAddress}</span> land here. Forward order or booking emails to it, or use it as your reply address.
      </p>
      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-sm text-muted">
          <Mail className="h-6 w-6" />
          No messages yet.
        </div>
      ) : (
        <div className="card grid min-h-[60vh] overflow-hidden md:grid-cols-[320px_1fr]">
          <ul className="divide-y divide-line/70 border-b border-line md:border-b-0 md:border-r" aria-label="Messages">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => select(m.id)}
                  aria-current={m.id === openId}
                  className={`block w-full px-4 py-3 text-left ${m.id === openId ? "bg-accent-tint" : "hover:bg-ground"}`}
                >
                  <div className="flex items-baseline gap-2">
                    {!m.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    <span className={`min-w-0 flex-1 truncate text-sm ${m.read_at ? "" : "font-semibold"}`}>{m.from_name ?? m.from_address}</span>
                    <span className="shrink-0 text-xs text-muted">{when(m.received_at)}</span>
                  </div>
                  <p className="truncate text-sm text-muted">{m.subject ?? "(no subject)"}</p>
                </button>
              </li>
            ))}
          </ul>
          {!open && <p className="hidden items-center justify-center p-6 text-sm text-muted md:flex">Pick a message to read it.</p>}
          {open && (
            <article className="min-w-0 p-6">
              <h2 className="text-lg font-semibold">{open.subject ?? "(no subject)"}</h2>
              <p className="mt-1 text-sm text-muted">
                {open.from_name ? `${open.from_name} · ` : ""}
                <a className="hover:underline" href={`mailto:${open.from_address}`}>{open.from_address}</a> · {when(open.received_at)}
                {open.forwarded_at && " · forwarded to you"}
              </p>
              <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed">{open.text_body ?? "This message has no plain-text part."}</div>
              <a className="btn-primary mt-6" href={`mailto:${open.from_address}?subject=${encodeURIComponent(`Re: ${open.subject ?? ""}`)}`}>Reply</a>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
