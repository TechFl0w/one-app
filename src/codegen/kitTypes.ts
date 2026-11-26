/**
 * Type declarations generated code is checked against: a small "react" (hooks + JSX) and the
 * kit ("@one/kit"). Kept self-contained so compiling needs no node_modules typings at runtime.
 * The runtime that implements these lives in src/sandbox/runtime.tsx — keep them in sync.
 */
export const KIT_DTS = String.raw`
declare namespace JSX {
  type Element = any;
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number | null }
  interface IntrinsicElements { [tag: string]: any }
}
declare module "react" {
  export type ReactNode = any;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(initial: S | (() => S)): [S, (v: SetStateAction<S>) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, (a: A) => void];
  export const Fragment: any;
  const React: { Fragment: any };
  export default React;
}
declare module "react/jsx-runtime" {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
}
declare module "@one/kit" {
  import type { ReactNode } from "react";

  /** Field values keyed by field id (fld_…). Links hold record ids. Dates are ISO strings. */
  export type RecordData = Record<string, unknown>;
  export interface RecordRow { id: string; data: RecordData; createdAt: string; updatedAt: string }
  export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "not_empty";
  /** Date values may be tokens: "@today", "@tomorrow", "@this_week", "@this_month", "@now". */
  export interface Filter { field: string; op: FilterOp; value?: string | number | boolean }
  export interface Query { table: string; filters?: Filter[]; sort?: { field: string; dir: "asc" | "desc" }[]; limit?: number; offset?: number }

  /** computed: worked out by One App (rollups, statuses that follow dates) — read it, never write it. */
  export interface FieldInfo { id: string; label: string; type: string; required?: boolean; computed?: boolean; options?: { id: string; label: string; color?: string }[]; to?: string }
  export interface TableInfo { id: string; label: string; primaryField?: string; fields: FieldInfo[] }
  export interface BusinessInfo { name: string; timezone: string; currency: string }

  /**
   * Live records for a query. Re-runs when the query changes and after any write. limit defaults
   * to 50; up to 5000 rows are fetched page by page. If loading fails and you don't read "error",
   * the part shows a standard error card with Retry (never a silent empty list).
   */
  export function useRecords(query: Query): { records: RecordRow[]; total: number; loading: boolean; error: string | null; reload(): void };
  /** One record (null while loading or if missing). */
  export function useRecord(table: string, id: string | null | undefined): { record: RecordRow | null; loading: boolean; error: string | null; reload(): void };
  /** The business's tables and fields (ids + labels + choice options). */
  export function useSchema(): { business: BusinessInfo; tables: TableInfo[] };
  /** Props set on the block that shows this component. On a record page, recordId is the record the page is about. */
  export function useProps<T = Record<string, unknown>>(): T;

  export const records: {
    list(query: Query): Promise<{ records: RecordRow[]; total: number }>;
    get(table: string, id: string): Promise<RecordRow>;
    create(table: string, data: RecordData): Promise<RecordRow>;
    update(table: string, id: string, data: RecordData): Promise<RecordRow>;
    /** Asks the owner to confirm (One App shows the dialog). Resolves false if they cancel. */
    remove(table: string, id: string): Promise<boolean>;
  };
  /** Label of a record (its title field; a choice shows its label). If the title is a link (a booking named by its client), show recordLabel of that linked record instead. */
  export function recordLabel(table: string, record: RecordRow): string;
  /** Label of a choice/status option id on a field. */
  export function optionLabel(table: string, field: string, optionId: unknown): string;

  /** Go to another page of the app (page id, e.g. "pg_clients"). */
  export function navigate(pageId: string): void;
  /** Open a record's own page (its details and everything linked to it). Clicking a record in a list or card should do this. */
  export function openRecord(table: string, recordId: string): void;
  /**
   * THE way to add or edit a record: One App opens a modal form over the whole page (validated,
   * right input per field, linked-record pickers). Resolves the saved record, or null if cancelled.
   * Lists refresh by themselves. defaults prefills a new record (e.g. { fld_client: clientId }).
   * When editing (recordId), the form also offers Delete, and asks before saving an amount change.
   */
  export function openRecordForm(opts: { table: string; recordId?: string; fields?: string[]; title?: string; submitLabel?: string; defaults?: RecordData }): Promise<RecordRow | null>;
  /** Count with the right word: plural(1, "tenant") → "1 tenant", plural(3, "person", "people") → "3 people". Use it for every count in text. */
  export function plural(n: number, one: string, many?: string): string;
  /** Short message at the bottom of the screen. */
  export function toast(message: string): void;
  export function formatMoney(amount: number | null | undefined): string;
  export function formatDate(iso: string | null | undefined, style?: "date" | "datetime" | "time" | "relative"): string;

  // ---- Files (file fields: photos, leases, receipts…) ----
  /** What a file field holds. Never build or guess one; it comes from an upload. */
  export interface FileValue { path: string; name: string; size?: number; mime?: string; /** A video's still frame. */ poster?: string; width?: number; height?: number }
  /** A gallery file field (multiple: true) holds FileValue[]; a single one holds FileValue or null. */
  /** Uploads one file the owner picked for a file field (photos are shrunk, videos get a still frame); save the result in that field (append it for a gallery). Forms (openRecordForm, RecordForm) and FileInput already do this for you. */
  export function uploadFile(table: string, field: string, file: File): Promise<FileValue>;
  /** A viewable URL for a file field's value (null while loading or when empty). Prefer FileImage. */
  export function useFileUrl(file: unknown): string | null;
  /** Opens a file (e.g. a lease PDF) in a new tab. */
  export function openFile(file: unknown): void;
  /** Shows photos and videos full screen in One App (swipe through, videos play). FileImage and Gallery do this on tap. */
  export function viewFiles(files: unknown, index?: number): void;

  // ---- UI parts (styled like One App; Tailwind classes also work everywhere) ----
  export function Card(props: { title?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode; padded?: boolean }): JSX.Element;
  export function Button(props: { variant?: "primary" | "ghost" | "danger" | "link"; size?: "sm" | "md"; type?: "button" | "submit"; disabled?: boolean; onClick?: () => void; className?: string; children?: ReactNode }): JSX.Element;
  export function Badge(props: { color?: string; children?: ReactNode; className?: string }): JSX.Element;
  /** A section that opens and closes with a chevron. */
  export function Collapsible(props: { title: ReactNode; defaultOpen?: boolean; actions?: ReactNode; className?: string; children?: ReactNode }): JSX.Element;
  export function Tabs(props: { tabs: { id: string; label: ReactNode; content: ReactNode }[]; defaultTab?: string; className?: string }): JSX.Element;
  export function Input(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: "text" | "email" | "tel" | "number" | "password"; label?: ReactNode; className?: string }): JSX.Element;
  export function Textarea(props: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label?: ReactNode; className?: string }): JSX.Element;
  /** Our dropdown (never the browser's). */
  export function Select(props: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; label?: ReactNode; className?: string }): JSX.Element;
  export function DateTimeInput(props: { value: string; onChange: (v: string) => void; withTime?: boolean; label?: ReactNode; className?: string }): JSX.Element;
  /** An inline form for a record (only when the design shows the form on the page itself — otherwise use openRecordForm). */
  export function RecordForm(props: { table: string; fields?: string[]; recordId?: string; submitLabel?: string; onSaved?: (record: RecordRow) => void; className?: string }): JSX.Element;
  /** Shows a file field's value: the photo, a video's still with a play button, or a chip for other files. Tap opens it full screen. A gallery value shows its first item (a cover). Set size/rounding with className. Empty: a soft image placeholder. */
  export function FileImage(props: { file: unknown; alt?: string; className?: string; fit?: "cover" | "contain"; onClick?: () => void }): JSX.Element;
  /** A grid of photos and videos (a gallery field's value); tap one to view all full screen. */
  export function Gallery(props: { files: unknown; className?: string; itemClassName?: string; empty?: ReactNode }): JSX.Element;
  /** Upload control for a file field: tap (phones offer the camera), drop or paste; uploads right away. multiple for gallery fields (onChange gets the whole list). accept defaults to photos and videos. */
  export function FileInput(props: { table: string; field: string; value: unknown; onChange: (v: FileValue | FileValue[] | null) => void; label?: ReactNode; accept?: string; multiple?: boolean; className?: string }): JSX.Element;
  /** THE kanban: cards can always be dragged between columns (saves "field"); columns default to the field's options; a click opens the record's page. Never build a board by hand. */
  export function Board(props: { table: string; field: string; records: RecordRow[]; renderCard: (record: RecordRow) => ReactNode; columns?: { id: string; label: string; color?: string }[]; onCardClick?: (record: RecordRow) => void; className?: string }): JSX.Element;
  export function Spinner(props: { className?: string }): JSX.Element;
  export function Empty(props: { children?: ReactNode; className?: string }): JSX.Element;
  export function Icon(props: { name: string; className?: string }): JSX.Element;
}
`;
