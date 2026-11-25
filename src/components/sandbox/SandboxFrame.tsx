"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { RecordQuery } from "@/schema/records";
import { Dialog } from "@/components/edit/Dialog";
import type { FrameToHost, HostToFrame, SandboxBridge, SandboxRecord, SandboxSchema } from "@/sandbox/protocol";
import type { Theme } from "@/schema/blueprint";
import { sandboxSrcdoc } from "./srcdoc";
import { registerCapture } from "./captureRegistry";
import { RecordDialog, parseFormRequest, type RecordFormRequest } from "./RecordDialog";

const noop = () => () => {};
const str = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v || v.length > 200) throw new Error(`Invalid ${what}`);
  return v;
};
const obj = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid data");
  return v as Record<string, unknown>;
};

/**
 * Hosts one generated component in a sandboxed frame and answers its requests. Every request is
 * validated here and run through `bridge` (as the signed-in user, or the demo). Deleting asks for
 * confirmation in One App's own dialog, which the frame can't draw or skip.
 */
export function SandboxFrame({
  compiled,
  props,
  schema,
  bridge,
  basePath,
  autoHeight = false,
  title,
  theme,
  componentId,
}: {
  theme?: Theme;
  /** Lets the chat ask this frame for a picture of itself (self-check). */
  componentId?: string;
  compiled: string;
  props: Record<string, unknown>;
  schema: SandboxSchema;
  bridge: SandboxBridge;
  basePath: string;
  autoHeight?: boolean;
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  // Only known in the browser; the frame is created after hydration.
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => null);
  const [height, setHeight] = useState<number | null>(null);
  const [crash, setCrash] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<{ request: RecordFormRequest; resolve: (r: SandboxRecord | null) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; resolve: (ok: boolean) => void } | null>(null);
  const themeKey = JSON.stringify(theme ?? null);
  const srcDoc = useMemo(() => (origin ? sandboxSrcdoc(origin, JSON.parse(themeKey) ?? undefined) : undefined), [origin, themeKey]);
  const init = useRef<HostToFrame>({ type: "init", compiled, props, schema, autoHeight });
  useEffect(() => {
    init.current = { type: "init", compiled, props, schema, autoHeight };
  }, [compiled, props, schema, autoHeight]);

  useEffect(() => {
    const send = (m: HostToFrame) => frame.current?.contentWindow?.postMessage(m, "*");
    const tableLabel = (id: string) => schema.tables.find((t) => t.id === id)?.label ?? "record";
    const onMessage = async (e: MessageEvent<FrameToHost>) => {
      // Only our own frame; its origin is opaque ("null"), so we match the window instead.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data;
      if (m?.type === "ready") return send(init.current);
      if (m?.type === "resize") return autoHeight && setHeight(Math.min(Math.max(m.height, 40), 20_000));
      if (m?.type === "crash") return setCrash(String(m.message).slice(0, 300));
      if (m?.type === "captured") {
        const done = captures.current.get(m.id);
        captures.current.delete(m.id);
        return done?.(typeof m.dataUrl === "string" && m.dataUrl.startsWith("data:image/jpeg;base64,") ? m.dataUrl : null);
      }
      if (m?.type !== "call" || typeof m.id !== "number") return;
      const a = Array.isArray(m.args) ? m.args : [];
      try {
        let value: unknown;
        switch (m.method) {
          case "records.list":
            value = await bridge.list(RecordQuery.parse(a[0]));
            break;
          case "records.get":
            value = await bridge.get(str(a[0], "table"), str(a[1], "id"));
            break;
          case "records.create":
            value = await bridge.create(str(a[0], "table"), obj(a[1]));
            break;
          case "records.update":
            value = await bridge.update(str(a[0], "table"), str(a[1], "id"), obj(a[2]));
            break;
          case "records.remove": {
            const table = str(a[0], "table");
            const id = str(a[1], "id");
            const ok = await new Promise<boolean>((resolve) => setConfirm({ label: tableLabel(table), resolve }));
            if (ok) await bridge.remove(table, id);
            value = ok;
            break;
          }
          case "navigate": {
            const page = str(a[0], "page");
            if (!/^pg_[a-z0-9_]{1,60}$/.test(page)) throw new Error("Unknown page");
            router.push(`${basePath}/p/${page}`);
            value = true;
            break;
          }
          case "form.open": {
            // Add/edit screens are a real modal over the whole page, drawn by One App.
            const request = parseFormRequest(a[0], schema);
            value = await new Promise<SandboxRecord | null>((resolve) => setForm({ request, resolve }));
            break;
          }
          case "toast":
            setToast(String(a[0] ?? "").slice(0, 200));
            value = true;
            break;
          default:
            throw new Error("Not allowed");
        }
        send({ type: "result", id: m.id, ok: true, value });
      } catch (err) {
        send({ type: "result", id: m.id, ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridge, schema, basePath, router, autoHeight]);

  // Self-check pictures: the frame renders itself to a JPEG on request.
  const captures = useRef(new Map<number, (url: string | null) => void>());
  useEffect(() => {
    if (!componentId) return;
    let next = 1;
    return registerCapture(componentId, () =>
      new Promise<string | null>((resolve) => {
        const id = next++;
        captures.current.set(id, resolve);
        frame.current?.contentWindow?.postMessage({ type: "capture", id } satisfies HostToFrame, "*");
        setTimeout(() => {
          if (captures.current.delete(id)) resolve(null);
        }, 8000);
      }),
    );
  }, [componentId, srcDoc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className={autoHeight ? "relative" : "relative h-full"}>
      {srcDoc && (
        <iframe
          // A new version of the component (after an edit) restarts the frame.
          key={compiled + themeKey}
          ref={frame}
          title={title}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="block w-full border-0 bg-transparent"
          style={autoHeight ? { height: height ?? 48 } : { height: "100%" }}
        />
      )}
      {crash && (
        <p className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> This part hit an error: {crash}. Ask the assistant to fix it, or undo the last change.
        </p>
      )}
      {toast && <p role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-soft">{toast}</p>}
      <RecordDialog
        request={form?.request ?? null}
        schema={schema}
        bridge={bridge}
        onDone={(saved) => {
          form?.resolve(saved);
          setForm(null);
          if (saved) setToast(form?.request.recordId ? "Saved" : "Added");
        }}
      />
      <Dialog open={!!confirm} onClose={() => { confirm?.resolve(false); setConfirm(null); }} title="Delete this record?">
        <p className="text-sm text-muted">This removes one {confirm?.label.toLowerCase()} record. It’s kept in the activity log.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => { confirm?.resolve(false); setConfirm(null); }}>Cancel</button>
          <button type="button" className="btn bg-red-700 text-white hover:bg-red-800" onClick={() => { confirm?.resolve(true); setConfirm(null); }}>Delete</button>
        </div>
      </Dialog>
    </div>
  );
}
