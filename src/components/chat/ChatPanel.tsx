"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, Check, Sparkles, X } from "lucide-react";
import type { ChatItem } from "@/agent/transcript";
import type { Message } from "@/agent/ownerAgent";
import type { PendingAction } from "@/agent/types";
import { undoChangeSet } from "@/engine/changeSet";
import { useEdit, type EditMode } from "@/components/edit/EditProvider";
import { resolveConfirmation, resolvePreview, sendOwnerMessage } from "@/app/b/[businessId]/chat-actions";
import { confirmDemoActions, sendDemoMessage } from "@/app/demo/chat-actions";

const SUGGESTIONS = ["What’s booked today?", "Add an “Allergies” field to Clients", "Make the calendar on this page bigger"];

const item = (role: ChatItem["role"], text: string, extra: Partial<ChatItem> = {}): ChatItem => ({
  id: crypto.randomUUID(),
  role,
  text,
  at: new Date().toISOString(),
  ...extra,
});

/** "Ask the assistant" panel, available on every page and aware of which page is open. */
export function ChatPanel({ mode, initialTranscript = [] }: { mode: EditMode; initialTranscript?: ChatItem[] }) {
  const { blueprint, adoptBlueprint, editing } = useEdit();
  const router = useRouter();
  const pathname = usePathname();
  const pageId = pathname.match(/\/p\/([^/]+)/)?.[1];
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<ChatItem[]>(initialTranscript);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  // Demo only: the browser holds the model history and pending actions.
  const demo = useRef<{ history: Message[]; pending: Map<string, PendingAction> }>({ history: [], pending: new Map() });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, busy, open]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setError(null);
    setTranscript((t) => [...t, item("owner", message)]);
    startTransition(async () => {
      if (mode.kind === "server") {
        const r = await sendOwnerMessage(mode.businessId, pageId, message);
        if (!r.ok) return setError(r.error);
        setTranscript(r.transcript);
        if (r.changed) router.refresh();
        return;
      }
      const r = await sendDemoMessage(blueprint, demo.current.history, message, pageId);
      if (!r.ok) return setError(r.error);
      demo.current.history = r.history;
      r.pending.forEach((p) => demo.current.pending.set(p.id, p));
      setTranscript((t) => [...t, item("assistant", r.response.text, { response: r.response })]);
      if (r.response.changed) adoptBlueprint(r.blueprint);
    });
  };

  const setResolved = (id: string, resolved: ChatItem["resolved"]) =>
    setTranscript((t) => t.map((i) => (i.id === id ? { ...i, resolved } : i)));

  const act = (chat: ChatItem, action: "keep" | "undo" | "confirm" | "cancel") => {
    setError(null);
    startTransition(async () => {
      if (mode.kind === "server") {
        const r =
          action === "keep" || action === "undo"
            ? await resolvePreview(mode.businessId, chat.id, action)
            : await resolveConfirmation(mode.businessId, chat.id, action);
        if (!r.ok) return setError(r.error);
        setTranscript(r.transcript);
        if (r.changed) router.refresh();
        return;
      }
      // Demo: everything happens on the browser's copy.
      if (action === "keep") return setResolved(chat.id, "kept");
      if (action === "undo") {
        const undo = chat.response?.preview?.undo;
        if (undo && "inverse" in undo) {
          try {
            adoptBlueprint(undoChangeSet(blueprint, undo.inverse, { confirmed: true }).blueprint);
          } catch (e) {
            return setError(e instanceof Error ? e.message : "Couldn’t undo.");
          }
        }
        demo.current.history.push({ role: "user", content: `[The owner undid this change: ${chat.response?.preview?.summary}]` });
        return setResolved(chat.id, "undone");
      }
      const actions = (chat.response?.confirm?.actionIds ?? []).map((id) => demo.current.pending.get(id)).filter((a): a is PendingAction => !!a);
      if (action === "cancel") {
        demo.current.history.push({ role: "user", content: `[The owner cancelled: ${chat.response?.confirm?.items.join("; ")}]` });
        return setResolved(chat.id, "cancelled");
      }
      const r = await confirmDemoActions(blueprint, actions);
      if (!r.ok) return setError(r.error);
      adoptBlueprint(r.blueprint);
      demo.current.history.push({ role: "user", content: r.notes.join("\n") });
      setResolved(chat.id, r.notes.some((n) => n.includes("failed")) ? "failed" : "confirmed");
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn-primary fixed bottom-5 right-5 z-30 shadow-soft ${editing ? "hidden" : ""}`}
      >
        <Sparkles className="h-4 w-4" /> Ask the assistant
      </button>
    );
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-card shadow-soft md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:border-l md:border-line" aria-label="Assistant">
      <header className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="flex-1 font-semibold">Assistant</h2>
        <button type="button" className="rounded-full p-1.5 hover:bg-ground" onClick={() => setOpen(false)} aria-label="Close assistant">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {transcript.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Ask about your business, or tell me what to change. I can see the page you’re on.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="block w-full rounded-2xl border border-line px-4 py-2.5 text-left text-sm hover:bg-ground" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {transcript.map((m) => (
          <ChatBubble key={m.id} item={m} busy={busy} onAction={(a) => act(m, a)} />
        ))}
        {busy && <p className="text-sm text-muted" role="status">Thinking…</p>}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="input max-h-40 min-h-11 resize-none"
          rows={1}
          placeholder="Ask or tell me what to change…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          aria-label="Message"
          maxLength={4000}
        />
        <button className="btn-primary h-11 w-11 shrink-0 p-0" disabled={busy || !draft.trim()} aria-label="Send">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </aside>
  );
}

const RESOLVED_LABEL: Record<NonNullable<ChatItem["resolved"]>, string> = {
  kept: "Kept",
  undone: "Undone",
  confirmed: "Done",
  cancelled: "Cancelled",
  failed: "Didn’t work",
};

function ChatBubble({ item: m, busy, onAction }: { item: ChatItem; busy: boolean; onAction: (a: "keep" | "undo" | "confirm" | "cancel") => void }) {
  if (m.role === "owner") {
    return <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white">{m.text}</p>;
  }
  const r = m.response;
  return (
    <div className="max-w-[92%] space-y-2">
      <p className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-ground px-4 py-2.5 text-sm">{m.text}</p>
      {r?.preview && (
        <div className="rounded-2xl border border-line p-3 text-sm">
          <p className="mb-1 font-semibold">{r.preview.summary}</p>
          <ul className="mb-2 list-disc space-y-0.5 pl-5 text-muted">
            {r.preview.ops.slice(0, 8).map((o, i) => <li key={i}>{o.description}</li>)}
            {r.preview.ops.length > 8 && <li>…and {r.preview.ops.length - 8} more</li>}
          </ul>
          {m.resolved ? <Resolved value={m.resolved} /> : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary px-4 py-1.5" disabled={busy} onClick={() => onAction("keep")}>Keep</button>
              <button type="button" className="btn-ghost px-4 py-1.5" disabled={busy} onClick={() => onAction("undo")}>Undo</button>
            </div>
          )}
        </div>
      )}
      {r?.confirm && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
          <p className="mb-1 font-semibold">Needs your OK</p>
          <ul className="mb-2 list-disc space-y-0.5 pl-5">
            {r.confirm.items.map((i, k) => <li key={k}>{i}</li>)}
          </ul>
          {m.resolved ? <Resolved value={m.resolved} /> : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary px-4 py-1.5" disabled={busy} onClick={() => onAction("confirm")}>Confirm</button>
              <button type="button" className="btn-ghost px-4 py-1.5" disabled={busy} onClick={() => onAction("cancel")}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Resolved({ value }: { value: NonNullable<ChatItem["resolved"]> }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
      <Check className="h-3.5 w-3.5" /> {RESOLVED_LABEL[value]}
    </p>
  );
}
