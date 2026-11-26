"use client";

import { createClient } from "@/lib/supabase/client";
import { FILES_BUCKET, MAX_FILE_BYTES } from "@/lib/files";
import { unwrap } from "@/sandbox/result";
import type { SandboxBridge, SandboxFile } from "@/sandbox/protocol";

export const filesSupported = (bridge: SandboxBridge) => !!bridge.uploadTarget && !!bridge.fileUrl;

/** Uploads one file for a file field (as the signed-in user) and returns the value to save. */
export async function uploadRecordFile(bridge: SandboxBridge, table: string, field: string, file: Blob, name: string): Promise<SandboxFile> {
  if (!bridge.uploadTarget) throw new Error("Files can’t be saved here (the demo doesn’t store files).");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files can be up to 20 MB.");
  const { path, token } = unwrap(await bridge.uploadTarget(table, field, name, file.size));
  const mime = file.type || undefined;
  const { error } = await createClient().storage.from(FILES_BUCKET).uploadToSignedUrl(path, token, file, { contentType: mime });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, name: name.slice(0, 255) || "file", size: file.size, ...(mime ? { mime: mime.slice(0, 100) } : {}) };
}

export async function recordFileUrl(bridge: SandboxBridge, path: string): Promise<string> {
  if (!bridge.fileUrl) throw new Error("Files aren’t available here.");
  return unwrap(await bridge.fileUrl(path));
}

export function asFile(v: unknown): SandboxFile | null {
  return v && typeof v === "object" && typeof (v as SandboxFile).path === "string" && typeof (v as SandboxFile).name === "string" ? (v as SandboxFile) : null;
}
