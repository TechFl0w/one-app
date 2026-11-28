"use client";

import { matchIcon } from "@/components/booking/parts";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ImagePlus, Paperclip, Play, X } from "lucide-react";
import { isImageFile, isVideoFile } from "@/lib/files";
import type { SandboxBridge, SandboxFile } from "@/sandbox/protocol";
import { asFiles, filesSupported, recordFileUrl, uploadRecordFile } from "@/components/sandbox/files";
import { useSandbox } from "@/components/sandbox/SandboxProvider";

/**
 * Photos and video, everywhere in One App: thumbnails (videos show their still frame and a play
 * badge), a full-screen viewer (swipe or arrows; videos play), and an uploader that takes drops,
 * pastes, several files at once and the phone camera, with progress on each.
 */

// ---------- signed links (cached: one per file per ~50 min) ----------

const urls = new Map<string, { at: number; url: Promise<string> }>();
export function useFileUrl(bridge: SandboxBridge | undefined, path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!bridge || !path || !filesSupported(bridge)) return;
    let hit = urls.get(path);
    if (!hit || Date.now() - hit.at > 50 * 60_000) {
      hit = { at: Date.now(), url: recordFileUrl(bridge, path) };
      hit.url.catch(() => urls.delete(path));
      urls.set(path, hit);
    }
    hit.url.then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [bridge, path]);
  return url;
}

// ---------- thumbnails ----------

export function MediaThumb({ file, bridge, className = "h-24 w-24 rounded-xl", onClick, label }: { file: SandboxFile; bridge?: SandboxBridge; className?: string; onClick?: () => void; label?: string }) {
  const video = isVideoFile(file);
  const picture = isImageFile(file) ? file.path : video ? file.poster : undefined;
  const url = useFileUrl(bridge, picture);
  const inner = picture ? (
    url ? (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
      <img src={url} alt={label ?? file.name} className="h-full w-full object-cover" />
    ) : (
      <span className="block h-full w-full animate-pulse bg-ground" />
    )
  ) : (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-ground px-2 text-center text-xs text-muted">
      <Paperclip className="h-5 w-5" />
      <span className="line-clamp-2 break-all">{file.name}</span>
    </span>
  );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick?.(); }} onPointerDown={(e) => e.stopPropagation()} className={`relative block shrink-0 overflow-hidden border border-line bg-ground ${className}`} aria-label={`Open ${label ?? file.name}`}>
      {inner}
      {video && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/70 text-white shadow-lg">
            <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
          </span>
        </span>
      )}
    </button>
  );
}

// ---------- full-screen viewer ----------

type Viewer = { open: (files: SandboxFile[], index: number, bridge: SandboxBridge | undefined) => void };
const ViewerCtx = createContext<Viewer | null>(null);
export const useMediaViewer = () => useContext(ViewerCtx);

/** Mounted once at the root: any thumbnail can open the full-screen viewer. */
export function MediaViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ files: SandboxFile[]; index: number; bridge?: SandboxBridge } | null>(null);
  const open = useCallback((files: SandboxFile[], index: number, bridge: SandboxBridge | undefined) => {
    if (files.length) setState({ files, bridge, index: Math.max(0, Math.min(index, files.length - 1)) });
  }, []);
  return (
    <ViewerCtx.Provider value={{ open }}>
      {children}
      {state && <ViewerDialog bridge={state.bridge} files={state.files} index={state.index} onIndex={(index) => setState({ ...state, index })} onClose={() => setState(null)} />}
    </ViewerCtx.Provider>
  );
}

function ViewerDialog({ bridge, files, index, onIndex, onClose }: { bridge?: SandboxBridge; files: SandboxFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const touch = useRef<number | null>(null);
  const file = files[index];
  const video = isVideoFile(file);
  const url = useFileUrl(bridge, file.path);
  const poster = useFileUrl(bridge, video ? file.poster : undefined);
  const go = (d: number) => onIndex((index + d + files.length) % files.length);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={file.name}
      className="m-0 h-full max-h-none w-full max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      onTouchStart={(e) => {
        touch.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          {files.length > 1 && <span className="text-white/60">{index + 1} / {files.length}</span>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="rounded-full p-2 text-white hover:bg-white/10" aria-label="Open the original">
              <Download className="h-5 w-5" />
            </a>
          )}
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
          {!url ? (
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : video ? (
            <video key={file.path} src={url} poster={poster ?? undefined} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
          ) : isImageFile(file) ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
            <img key={file.path} src={url} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain" />
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="btn-primary">Open {file.name}</a>
          )}
          {files.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block" aria-label="Previous">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block" aria-label="Next">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

// ---------- gallery (read-only grid that opens the viewer) ----------

export function MediaGallery({ value, bridge, size = "h-24 w-24", label }: { value: unknown; bridge?: SandboxBridge; size?: string; label?: string }) {
  const viewer = useMediaViewer();
  const files = asFiles(value);
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <MediaThumb key={f.path} file={f} bridge={bridge} className={`${size} rounded-xl`} label={label} onClick={() => viewer?.open(files, i, bridge)} />
      ))}
    </div>
  );
}

// ---------- uploader ----------

type Pending = { id: number; name: string; preview: string | null; video: boolean; progress: number; error?: string };
let seq = 0;

/**
 * The upload control for a file field: drop files on it, paste them (anywhere while it's on
 * screen), or tap to pick — on a phone that offers the camera. Several at once for galleries;
 * each shows its own progress. `onChange` gets the field's new value.
 */
export function MediaUploader({
  bridge,
  table,
  field,
  value,
  onChange,
  multiple = false,
  accept = "image/*,video/*",
  id,
  required,
  name,
}: {
  bridge: SandboxBridge;
  table: string;
  field: string;
  value: unknown;
  onChange: (v: SandboxFile | SandboxFile[] | null) => void;
  multiple?: boolean;
  accept?: string;
  id?: string;
  required?: boolean;
  /** Posts the value as JSON in a form under this name. */
  name?: string;
}) {
  const viewer = useMediaViewer();
  const files = asFiles(value);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latestRef = useRef(files);
  useEffect(() => {
    latestRef.current = files;
  });

  const add = useCallback(
    async (picked: File[]) => {
      const list = multiple ? picked : picked.slice(0, 1);
      if (!list.length) return;
      const jobs = list.map((f) => ({ id: ++seq, file: f }));
      setPending((p) => [...p, ...jobs.map(({ id, file }) => ({ id, name: file.name, video: isVideoFile({ mime: file.type, name: file.name }), preview: isImageFile({ mime: file.type, name: file.name }) ? URL.createObjectURL(file) : null, progress: 0 }))]);
      // Three at a time: fast on good connections, kind to phones.
      const queue = [...jobs];
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { id, file } = job;
          try {
            const up = await uploadRecordFile(bridge, table, field, file, file.name, (p) => setPending((all) => all.map((x) => (x.id === id ? { ...x, progress: p } : x))));
            const next = multiple ? [...latestRef.current, up] : [up];
            latestRef.current = next;
            onChange(multiple ? next : up);
            setPending((all) => all.filter((x) => x.id !== id));
          } catch (e) {
            setPending((all) => all.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x)));
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    },
    [bridge, table, field, multiple, onChange],
  );

  // Paste photos straight from the clipboard (a screenshot, a copied picture).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (!pasted.length || !filesSupported(bridge)) return;
      e.preventDefault();
      void add(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add, bridge]);

  if (!filesSupported(bridge)) return <p className="text-sm text-muted">Photos and files can’t be added in the demo.</p>;
  const remove = (path: string) => {
    const next = files.filter((f) => f.path !== path);
    latestRef.current = next;
    onChange(multiple ? next : null);
  };
  const busy = pending.some((p) => !p.error);
  const empty = !files.length && !pending.length;
  const media = accept.includes("image") || accept.includes("video");

  return (
    <div
      className={`relative rounded-2xl transition-colors ${over ? "bg-accent-tint ring-2 ring-accent" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      {name && <input type="hidden" name={name} value={multiple ? (files.length ? JSON.stringify(files) : "") : files[0] ? JSON.stringify(files[0]) : ""} />}
      {required && empty && <input tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" required value="" onChange={() => {}} onFocus={() => input.current?.focus()} />}
      <input ref={input} id={id} type="file" className="sr-only" accept={accept} multiple={multiple} onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {empty ? (
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-7 text-sm text-muted hover:border-accent hover:text-accent">
          <ImagePlus className="h-7 w-7" />
          <span className="font-semibold text-ink">{media ? (multiple ? "Add photos or videos" : "Add a photo") : "Add a file"}</span>
          <span className="text-xs">Drop here, paste, or tap{media ? " — on a phone you can take one" : ""}</span>
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={f.path} className="group relative">
              <MediaThumb file={f} bridge={bridge} className="h-24 w-24 rounded-xl" onClick={() => viewer?.open(files, i, bridge)} />
              <button type="button" onClick={() => remove(f.path)} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-1 text-white shadow opacity-90 hover:opacity-100" aria-label={`Remove ${f.name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.id} className="relative h-24 w-24 overflow-hidden rounded-xl border border-line bg-ground" title={p.error ?? p.name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the file being uploaded */}
              {p.preview && <img src={p.preview} alt="" className="h-full w-full object-cover opacity-60" />}
              {!p.preview && <span className="flex h-full items-center justify-center text-xs text-muted">{p.video ? "Video" : "File"}</span>}
              {p.error ? (
                <span className="absolute inset-x-1 bottom-1 rounded-md bg-red-700 px-1 py-0.5 text-center text-[10px] font-semibold text-white">Failed</span>
              ) : (
                <span className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                  <span className="block h-full bg-accent transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                </span>
              )}
            </div>
          ))}
          {(multiple || !files.length) && (
            <button type="button" onClick={() => input.current?.click()} disabled={!multiple && busy} className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent">
              <ImagePlus className="h-5 w-5" /> Add
            </button>
          )}
          {!multiple && files.length > 0 && (
            <button type="button" onClick={() => input.current?.click()} className="self-end text-sm font-medium text-accent hover:underline">
              Replace
            </button>
          )}
        </div>
      )}
      {pending.filter((p) => p.error).map((p) => (
        <p key={p.id} className="mt-1 text-sm text-red-700">{p.name}: {p.error}</p>
      ))}
    </div>
  );
}

// ---------- in tables, cards and lists ----------

/** A file field's value in a table cell or card: small thumbnails (tap to view), a count past three. */
export function FileCell({ value, size = "h-10 w-10" }: { value: unknown; size?: string }) {
  const viewer = useMediaViewer();
  const bridge = useSandbox()?.bridge;
  const files = asFiles(value);
  const shown = files.slice(0, 3);
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {shown.map((f, i) => (
        <MediaThumb
          key={f.path}
          file={f}
          bridge={bridge}
          className={`${size} rounded-lg`}
          onClick={() => viewer?.open(files, i, bridge)}
        />
      ))}
      {files.length > 3 && <span className="text-xs font-semibold text-muted">+{files.length - 3}</span>}
    </span>
  );
}

/**
 * A record's cover picture on cards and list rows (its first photo, or a video's still). Not a
 * button: tapping the card opens the record. No photo yet: a soft placeholder.
 */
export function CoverImage({ value, className = "h-28 w-full", label }: { value: unknown; className?: string; label?: string }) {
  const bridge = useSandbox()?.bridge;
  const file = asFiles(value).find((f) => isImageFile(f) || isVideoFile(f));
  const video = !!file && isVideoFile(file);
  const url = useFileUrl(bridge, file ? (video ? file.poster : file.path) : undefined);
  const starter = !url && label ? matchIcon(label) : undefined;
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-[#ECE7DD] to-[#DDD5C7] text-[#9A9283] ${className}`} role="img" aria-label={label ? `Photo of ${label}` : "Photo"}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : starter ? (
        // No photo yet: a fitting starter icon (scissors for a cut, a paw for grooming).
        <span className="flex h-full w-full items-center justify-center bg-accent-tint text-accent">
          {createElement(starter, { className: "h-7 w-7", "aria-hidden": true })}
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImagePlus className="h-6 w-6 opacity-60" aria-hidden />
        </span>
      )}
      {video && (
        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-white">
          <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />
        </span>
      )}
    </div>
  );
}
