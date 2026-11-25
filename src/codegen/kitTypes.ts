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

  export interface FieldInfo { id: string; label: string; type: string; required?: boolean; options?: { id: string; label: string; color?: string }[]; to?: string }
  export interface TableInfo { id: string; label: string; primaryField?: string; fields: FieldInfo[] }
  export interface BusinessInfo { name: string; timezone: string; currency: string }

  /** Live records for a query. Re-runs when the query changes; reload() after your own writes. */
  export function useRecords(query: Query): { records: RecordRow[]; total: number; loading: boolean; error: string | null; reload(): void };
  /** One record (null while loading or if missing). */
  export function useRecord(table: string, id: string | null | undefined): { record: RecordRow | null; loading: boolean; error: string | null; reload(): void };
  /** The business's tables and fields (ids + labels + choice options). */
  export function useSchema(): { business: BusinessInfo; tables: TableInfo[] };
  /** Props set on the block that shows this component. */
  export function useProps<T = Record<string, unknown>>(): T;

  export const records: {
    list(query: Query): Promise<{ records: RecordRow[]; total: number }>;
    get(table: string, id: string): Promise<RecordRow>;
    create(table: string, data: RecordData): Promise<RecordRow>;
    update(table: string, id: string, data: RecordData): Promise<RecordRow>;
    /** Asks the owner to confirm (One App shows the dialog). Resolves false if they cancel. */
    remove(table: string, id: string): Promise<boolean>;
  };
  /** Label of a record (its primary field), e.g. for links. */
  export function recordLabel(table: string, record: RecordRow): string;
  /** Label of a choice/status option id on a field. */
  export function optionLabel(table: string, field: string, optionId: unknown): string;

  /** Go to another page of the app (page id, e.g. "pg_clients"). */
  export function navigate(pageId: string): void;
  /**
   * THE way to add or edit a record: One App opens a modal form over the whole page (validated,
   * right input per field, linked-record pickers). Resolves the saved record, or null if cancelled.
   * Lists refresh by themselves. defaults prefills a new record (e.g. { fld_client: clientId }).
   */
  export function openRecordForm(opts: { table: string; recordId?: string; fields?: string[]; title?: string; submitLabel?: string; defaults?: RecordData }): Promise<RecordRow | null>;
  /** Short message at the bottom of the screen. */
  export function toast(message: string): void;
  export function formatMoney(amount: number | null | undefined): string;
  export function formatDate(iso: string | null | undefined, style?: "date" | "datetime" | "time" | "relative"): string;

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
  export function Spinner(props: { className?: string }): JSX.Element;
  export function Empty(props: { children?: ReactNode; className?: string }): JSX.Element;
  export function Icon(props: { name: string; className?: string }): JSX.Element;
}
`;
