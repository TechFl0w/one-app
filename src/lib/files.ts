/**
 * Files attached to records (file fields). Stored in a private Supabase Storage bucket under the
 * business's own folder, so storage policies can check membership from the path alone:
 *   <business id>/<table id>/<random id>/<file name>
 * A record only ever points at a file in its own business's folder.
 */
export const FILES_BUCKET = "record-files";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Keeps a readable name but only characters that are safe in a storage path. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^[.\-]+/, "").slice(-120);
  return clean || "file";
}

export function filePathFor(businessId: string, tableId: string, name: string, id: string = crypto.randomUUID()): string {
  return `${businessId}/${tableId}/${id}/${safeFileName(name)}`;
}

/** True only for a path inside this business's folder (no tricks with "..", empty parts or slashes). */
export function isBusinessFilePath(businessId: string, path: string): boolean {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === businessId && parts.every((p) => p.length > 0 && p !== "." && p !== "..");
}

export const isImageFile = (f: { mime?: string; name?: string } | null | undefined) =>
  !!f && (f.mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(f.name ?? ""));
