/** Messages between One App (host) and a sandboxed component frame. Shared by both sides. */
import type { RecordQuery } from "@/schema/records";
import type { BridgeResult } from "./result";

export interface SandboxSchema {
  business: { name: string; timezone: string; currency: string };
  tables: { id: string; label: string; primaryField?: string; openIn?: "page" | "modal"; fields: { id: string; label: string; type: string; required?: boolean; computed?: boolean; multiple?: boolean; options?: { id: string; label: string; color?: string }[]; to?: string }[] }[];
}

export interface SandboxRecord {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type HostToFrame =
  | { type: "init"; compiled: string; props: Record<string, unknown>; schema: SandboxSchema; autoHeight: boolean }
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string }
  /** Asks the frame for a picture of what it shows (the assistant's self-check). */
  | { type: "capture"; id: number };

export type CallMethod = "records.list" | "records.get" | "records.create" | "records.update" | "records.remove" | "navigate" | "toast" | "form.open" | "files.upload" | "files.read" | "files.open" | "files.view" | "record.open";

/** What a file field holds (schema/records FileValue). */
export interface SandboxFile {
  path: string;
  name: string;
  size?: number;
  mime?: string;
  /** Videos: the still frame shown before playing. */
  poster?: string;
  width?: number;
  height?: number;
}

export type FrameToHost =
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "call"; id: number; method: CallMethod; args: unknown[] }
  | { type: "crash"; message: string }
  | { type: "captured"; id: number; dataUrl: string | null };

/** What the host lets a frame do. Implementations run as the signed-in user (or the demo); failures come back as data (typed codes). */
export interface SandboxBridge {
  list(q: RecordQuery): Promise<BridgeResult<{ records: SandboxRecord[]; total: number }>>;
  get(table: string, id: string): Promise<BridgeResult<SandboxRecord>>;
  create(table: string, data: Record<string, unknown>): Promise<BridgeResult<SandboxRecord>>;
  /** `confirmed` only after the owner said yes in One App's own dialog (amount changes). */
  update(table: string, id: string, data: Record<string, unknown>, confirmed?: boolean): Promise<BridgeResult<SandboxRecord>>;
  /** Only called after the owner confirmed in One App's own dialog. */
  remove(table: string, id: string): Promise<BridgeResult<void>>;
  /** File fields. Missing where files can't be stored (the demo). */
  uploadTarget?(table: string, field: string, name: string, size: number, mime?: string): Promise<BridgeResult<{ path: string; url: string }>>;
  fileUrl?(path: string): Promise<BridgeResult<string>>;
  /** A screen's compiled code and styles, for screens the page didn't render (Edit mode drafts). */
  loadComponent?(componentId: string): Promise<BridgeResult<{ compiled: string; css?: string }>>;
}

/** Stands in for a screen's compiled code in the browser's copy of the setup; the real code is
 * rendered with the page, or fetched on demand (SandboxBridge.loadComponent). */
export const CODE_ON_DEMAND = "/* loaded on demand */";
