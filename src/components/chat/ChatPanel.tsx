"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, Check, ImagePlus, Sparkles, X } from "lucide-react";
import type { ChatImage } from "@/agent/ownerAgent";
import type { BuildPlan } from "@/agent/types";
import { captureComponent } from "@/components/sandbox/captureRegistry";
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
  const [images, setImages] = useState<(ChatImage & { url: string })[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const addFiles = async (files: FileList | File[]) => {
    const all = [...files];
    const picked = all.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(f.name)).slice(0, Math.max(0, 8 - images.length));
    if (!picked.length) {
      if (all.length) setError("That isn’t an image. Attach a PNG or JPEG screenshot.");
      return;
    }
    const ready = await Promise.all(picked.map(shrinkImage));
    const ok = ready.filter((r): r is ChatImage & { url: string } => !!r);
    setError(ok.length < picked.length ? "Couldn’t read one of the images — try a PNG or JPEG screenshot." : null);
    setImages((x) => [...x, ...ok].slice(0, 8));
  };
  // Images from the clipboard: Chrome fills `files`, Safari only `items`.
  const fromClipboard = (data: DataTransfer) => {
    const files = data.files.length ? [...data.files] : [...data.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
    return files.filter((f) => f.type.startsWith("image/"));
  };
  const [busy, startTransition] = useTransition();
  // Demo only: the browser holds the model history and pending actions.
  const demo = useRef<{ history: Message[]; pending: Map<string, PendingAction> }>({ history: [], pending: new Map() });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, busy, open]);

  // Self-check: after the assistant writes a component, picture it and send it back (max 2 rounds).
  const round = useRef(0);
  const designs = useRef<ChatImage[]>([]);
  const checked = useRef(new Set<string>());
  const basePath = mode.kind === "server" ? `/b/${mode.businessId}` : "/demo";

  const deliver = (message: string, attached: ChatImage[], shown: string) => {
    setError(null);
    setTranscript((t) => [...t, item("owner", shown)]);
    startTransition(async () => {
      if (mode.kind === "server") {
        const r = await sendOwnerMessage(mode.businessId, pageId, message, attached, shown);
        if (!r.ok) return setError(r.error);
        setTranscript(r.transcript);
        if (r.changed) router.refresh();
        return;
      }
      const r = await sendDemoMessage(blueprint, demo.current.history, message, pageId, attached);
      if (!r.ok) return setError(r.error);
      demo.current.history = r.history;
      r.pending.forEach((p) => demo.current.pending.set(p.id, p));
      setTranscript((t) => [...t, item("assistant", r.response.text, { response: r.response })]);
      if (r.response.changed) adoptBlueprint(r.blueprint);
    });
  };

  const send = (text: string) => {
    const message = text.trim();
    if ((!message && !images.length) || busy) return;
    const attached = images.map(({ mediaType, data }) => ({ mediaType, data }));
    setDraft("");
    setImages([]);
    // A new request from the owner: its images (if any) are the design to check against.
    round.current = 0;
    autoSteps.current = 0;
    // New images start a new design reference; a plain message keeps the screenshots of a build.
    if (attached.length) designs.current = attached;
    deliver(message, attached, attached.length ? `${message}${message ? "\n" : ""}[${attached.length} image${attached.length > 1 ? "s" : ""} attached]` : message);
  };

  // Multi-step builds (recreating an app): keep going until every step of the plan is done.
  const plan = useRef<BuildPlan | null>(null);
  const autoSteps = useRef(0);
  const stalled = useRef({ key: "", count: 0 });
  const continuePlan = useEffectEvent(() => {
    const next = plan.current?.steps.find((s) => !s.done);
    if (!next || autoSteps.current >= 15) return;
    // Stop if the same step keeps coming back without progress (the owner can say "continue").
    const key = JSON.stringify(plan.current?.steps.map((s) => s.done));
    stalled.current = stalled.current.key === key ? { key, count: stalled.current.count + 1 } : { key, count: 0 };
    if (stalled.current.count >= 2) return;
    autoSteps.current += 1;
    round.current = 0;
    deliver(
      `[Automatic] Continue the plan "${plan.current!.goal}": do the next step now — ${next.title}.${designs.current.length ? " The screenshots are attached again." : ""}`,
      designs.current,
      `Next: ${next.title}…`,
    );
  });

  // Self-check of the component just written; if it can't be pictured, the build simply moves on.
  const selfCheck = useEffectEvent(async (target: { componentId: string; pageId?: string }) => {
    if (target.pageId && target.pageId !== pageId) router.push(`${basePath}/p/${target.pageId}`);
    const shot = await captureComponent(target.componentId);
    if (!shot) return continuePlan();
    round.current += 1;
    const picture: ChatImage = { mediaType: "image/jpeg", data: shot.slice(shot.indexOf(",") + 1) };
    const withDesign = designs.current.length ? ` The owner's design${designs.current.length > 1 ? "s follow" : " follows"} it.` : "";
    deliver(`[Automatic check] The first image is how the component you just wrote (${target.componentId}) renders right now.${withDesign} Compare and fix anything that's off, or confirm briefly.`, [picture, ...designs.current].slice(0, 8), "Checking how it looks…");
  });

  useEffect(() => {
    if (busy) return;
    const last = transcript.at(-1);
    if (!last || last.role !== "assistant" || checked.current.has(last.id)) return;
    checked.current.add(last.id);
    if (last.response?.plan) plan.current = last.response.plan;
    if (last.response?.confirm && !last.resolved) return; // waits for the owner
    const verify = last.response?.verify;
    if (verify?.length && round.current < 2) void selfCheck(verify[0]);
    else continuePlan();
  }, [transcript, busy]);

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
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-card shadow-soft md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:border-l md:border-line"
      aria-label="Assistant"
      // Drop images anywhere on the panel.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
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

      {images.length > 0 && (
        <ul className="flex gap-2 border-t border-line px-3 pt-3" aria-label="Attached images">
          {images.map((im, i) => (
            <li key={im.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an attached image */}
              <img src={im.url} alt="" className="h-14 w-14 rounded-xl border border-line object-cover" />
              <button type="button" className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-white" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} aria-label="Remove image">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onPaste={(e) => {
          const files = fromClipboard(e.clipboardData);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <button type="button" className="h-11 w-11 shrink-0 rounded-full p-0 text-muted hover:bg-ground hover:text-ink disabled:opacity-40" onClick={() => fileRef.current?.click()} disabled={busy || images.length >= 8} aria-label="Attach an image" title="Attach a design or screenshot">
          <ImagePlus className="mx-auto h-5 w-5" />
        </button>
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
        <button className="btn-primary h-11 w-11 shrink-0 p-0" disabled={busy || (!draft.trim() && !images.length)} aria-label="Send">
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

/** Scales an image down (longest side 1280px, JPEG) so a few fit in one message. */
async function shrinkImage(file: File): Promise<(ChatImage & { url: string }) | null> {
  try {
    // createImageBitmap where available; an <img> otherwise (older Safari, some formats).
    const bitmap: { width: number; height: number } & CanvasImageSource = await createImageBitmap(file).catch(
      () =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        }),
    );
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.82);
    return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
  } catch {
    return null;
  }
}
