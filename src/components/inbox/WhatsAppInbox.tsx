"use client";

import { useState, useTransition } from "react";
import { Bot, MessageCircle, UserRound } from "lucide-react";
import { inSessionWindow } from "@/whatsapp/core";

export interface ConversationItem {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  mode: "agent" | "owner";
  last_inbound_at: string | null;
  last_message_at: string | null;
  unread: number;
}
export interface ConversationMessage {
  id: number;
  direction: "in" | "out";
  author: string;
  body: string;
  created_at: string;
}

const AUTHOR: Record<string, string> = { agent: "Assistant", owner: "You", automation: "Automation" };

/** WhatsApp conversations: the assistant answers until you take over; reply within 24 hours. */
export function WhatsAppInbox({
  items: initial,
  timezone,
  load,
  reply,
  setMode,
  markRead,
}: {
  items: ConversationItem[];
  timezone: string;
  load: (id: string) => Promise<ConversationMessage[]>;
  reply: (id: string, body: string) => Promise<{ ok?: boolean; message?: string }>;
  setMode: (id: string, mode: "agent" | "owner") => Promise<void>;
  markRead: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const open = items.find((c) => c.id === openId);
  const when = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso)) : "";

  const select = (id: string) => {
    setOpenId(id);
    setError(null);
    start(async () => setMessages(await load(id)));
    if (items.find((c) => c.id === id)?.unread) {
      setItems((l) => l.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
      start(() => markRead(id));
    }
  };
  const toggle = (c: ConversationItem) => {
    const mode = c.mode === "agent" ? "owner" : "agent";
    setItems((l) => l.map((x) => (x.id === c.id ? { ...x, mode } : x)));
    start(() => setMode(c.id, mode));
  };
  const send = (c: ConversationItem) => {
    const body = draft;
    start(async () => {
      const r = await reply(c.id, body);
      if (!r.ok) return setError(r.message ?? "Couldn’t send.");
      setDraft("");
      setError(null);
      setItems((l) => l.map((x) => (x.id === c.id ? { ...x, mode: "owner" } : x)));
      setMessages(await load(c.id));
    });
  };

  if (items.length === 0)
    return (
      <div className="card flex flex-col items-center gap-2 p-12 text-center text-sm text-muted">
        <MessageCircle className="h-6 w-6" />
        No WhatsApp conversations yet.
      </div>
    );

  const canReply = open ? inSessionWindow(open.last_inbound_at) : false;
  return (
    <div className="card grid min-h-[60vh] overflow-hidden md:grid-cols-[320px_1fr]">
      <ul className="divide-y divide-line/70 border-b border-line md:border-b-0 md:border-r" aria-label="Conversations">
        {items.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => select(c.id)} aria-current={c.id === openId} className={`block w-full px-4 py-3 text-left ${c.id === openId ? "bg-accent-tint" : "hover:bg-ground"}`}>
              <div className="flex items-baseline gap-2">
                {c.unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                <span className={`min-w-0 flex-1 truncate text-sm ${c.unread ? "font-semibold" : ""}`}>{c.customer_name ?? c.customer_phone}</span>
                <span className="shrink-0 text-xs text-muted">{when(c.last_message_at)}</span>
              </div>
              <p className="flex items-center gap-1 text-xs text-muted">
                {c.mode === "agent" ? <><Bot className="h-3 w-3" /> Assistant answering</> : <><UserRound className="h-3 w-3" /> You’re answering</>}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {!open && <p className="hidden items-center justify-center p-6 text-sm text-muted md:flex">Pick a conversation.</p>}
      {open && (
        <section className="flex min-w-0 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{open.customer_name ?? open.customer_phone}</h2>
              <p className="text-xs text-muted">{open.customer_phone}</p>
            </div>
            <button type="button" className="btn-ghost px-3 py-1.5" disabled={busy} onClick={() => toggle(open)}>
              {open.mode === "agent" ? "Take over" : "Hand back to assistant"}
            </button>
          </header>
          <ol className="flex-1 space-y-3 overflow-y-auto p-5" aria-label="Messages">
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.direction === "out" ? "bg-accent-tint" : "bg-ground"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-[11px] text-muted">{m.direction === "out" ? `${AUTHOR[m.author] ?? m.author} · ` : ""}{when(m.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
          <form className="border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); send(open); }}>
            {canReply ? (
              <div className="flex gap-2">
                <input className="input flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a reply…" aria-label="Reply" maxLength={4000} />
                <button className="btn-primary" disabled={busy || !draft.trim()}>Send</button>
              </div>
            ) : (
              <p className="text-sm text-muted">It’s been more than 24 hours since their last message, so WhatsApp only allows approved templates (automations send those).</p>
            )}
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          </form>
        </section>
      )}
    </div>
  );
}
