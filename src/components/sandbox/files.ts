"use client";

import { isImageFile, isVideoFile, maxBytesFor, sizeLabel } from "@/lib/files";
import { unwrap } from "@/sandbox/result";
import type { SandboxBridge, SandboxFile } from "@/sandbox/protocol";

/**
 * Uploads for file fields, made for photos and video from a phone: photos are shrunk in the
 * browser (sharp at 2400 px, a fraction of the bytes), videos get a still frame to show before
 * they play, and every upload reports progress. Files go straight to storage with a one-time
 * signed URL (the server checks the field and size first).
 */

export const filesSupported = (bridge: SandboxBridge) => !!bridge.uploadTarget && !!bridge.fileUrl;

const MAX_EDGE = 2400;
type Progress = (fraction: number) => void;

/** Uploads one picked/dropped/pasted file for a file field and returns the value to save. */
export async function uploadRecordFile(bridge: SandboxBridge, table: string, field: string, file: Blob, name: string, onProgress?: Progress): Promise<SandboxFile> {
  if (!bridge.uploadTarget) throw new Error("Files can’t be saved here (the demo doesn’t store files).");
  const meta = { name: name.slice(0, 255) || "file", mime: file.type || guessMime(name) };
  if (isImageFile(meta) && !/gif|svg/.test(meta.mime ?? "")) {
    const shrunk = await shrinkImage(file).catch(() => null);
    if (shrunk) {
      const up = await put(bridge, table, field, shrunk.blob, renameExt(meta.name, shrunk.ext), onProgress);
      return { ...up, width: shrunk.width, height: shrunk.height };
    }
  }
  if (isVideoFile(meta)) {
    // The still frame first (small), then the video with real progress.
    const still = await videoStill(file).catch(() => null);
    const poster = still ? await put(bridge, table, field, still.blob, renameExt(meta.name, "jpg")).catch(() => null) : null;
    const up = await put(bridge, table, field, file, meta.name, onProgress, meta.mime);
    return { ...up, ...(poster ? { poster: poster.path } : {}), ...(still ? { width: still.width, height: still.height } : {}) };
  }
  return put(bridge, table, field, file, meta.name, onProgress, meta.mime);
}

async function put(bridge: SandboxBridge, table: string, field: string, blob: Blob, name: string, onProgress?: Progress, mimeHint?: string): Promise<SandboxFile> {
  const mime = blob.type || mimeHint || "application/octet-stream";
  const limit = maxBytesFor(mime);
  if (blob.size > limit) throw new Error(`${name} is ${sizeLabel(blob.size)}; ${mime.startsWith("video/") ? "videos" : "files"} can be up to ${sizeLabel(limit)}.`);
  const target = unwrap(await bridge.uploadTarget!(table, field, name, blob.size, mime));
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(uploadError(xhr))));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new File([blob], name, { type: mime }));
    xhr.send(form);
  });
  onProgress?.(1);
  return { path: target.path, name: name.slice(0, 255), size: blob.size, mime: mime.slice(0, 100) };
}

function uploadError(xhr: XMLHttpRequest): string {
  if (xhr.status === 413) return "That file is larger than your storage allows.";
  try {
    const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
    return `Upload failed: ${body.message ?? body.error ?? xhr.status}`;
  } catch {
    return `Upload failed (${xhr.status}).`;
  }
}

/** Shrinks a photo to MAX_EDGE (keeps orientation) as WebP, or JPEG where WebP can't be made. */
async function shrinkImage(file: Blob): Promise<{ blob: Blob; width: number; height: number; ext: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  // Already small: keep the original (no quality loss).
  if (scale === 1 && file.size < 1_500_000) {
    bitmap.close();
    return { blob: file, width, height, ext: extOf(file.type) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (webp && webp.type === "image/webp") return { blob: webp, width, height, ext: "webp" };
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  if (!jpeg) throw new Error("Couldn’t read that photo");
  return { blob: jpeg, width, height, ext: "jpg" };
}

/** A still from early in a video (its poster). */
function videoStill(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (e?: Error) => {
      URL.revokeObjectURL(url);
      if (e) reject(e);
    };
    const timer = setTimeout(() => done(new Error("No frame")), 8000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => (v.currentTime = Math.min(0.5, (v.duration || 1) / 2));
    v.onseeked = () => {
      clearTimeout(timer);
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        done();
        if (b) resolve({ blob: b, width: v.videoWidth, height: v.videoHeight });
        else reject(new Error("No frame"));
      }, "image/jpeg", 0.8);
    };
    v.onerror = () => {
      clearTimeout(timer);
      done(new Error("Can’t read that video"));
    };
    v.src = url;
  });
}

const extOf = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
const renameExt = (name: string, ext: string) => `${name.replace(/\.[a-z0-9]{2,5}$/i, "")}.${ext}`;
function guessMime(name: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm", pdf: "application/pdf" } as Record<string, string>)[ext] : undefined;
}

export async function recordFileUrl(bridge: SandboxBridge, path: string): Promise<string> {
  if (!bridge.fileUrl) throw new Error("Files aren’t available here.");
  return unwrap(await bridge.fileUrl(path));
}

export function asFile(v: unknown): SandboxFile | null {
  return v && typeof v === "object" && typeof (v as SandboxFile).path === "string" && typeof (v as SandboxFile).name === "string" ? (v as SandboxFile) : null;
}

/** A file field's value as a list (a gallery holds several; a single field one or none). */
export const asFiles = (v: unknown): SandboxFile[] => (Array.isArray(v) ? v : v ? [v] : []).map(asFile).filter((f): f is SandboxFile => !!f);
