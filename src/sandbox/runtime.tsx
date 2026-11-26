/**
 * Runs inside the sandboxed iframe (opaque origin, no network). Bundled separately by
 * scripts/build-sandbox.mjs into public/sandbox/runtime.js. It evaluates one compiled component
 * and gives it the kit; every data call goes to the host over postMessage.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { toJpeg } from "html-to-image";
import type { CallMethod, FrameToHost, HostToFrame, SandboxRecord, SandboxSchema } from "./protocol";

const { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } = React;

// ---------- bridge ----------

const post = (m: FrameToHost) => window.parent.postMessage(m, "*");
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
function call<T>(method: CallMethod, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    post({ type: "call", id, method, args });
  });
}

// ---------- context ----------

interface Ctx {
  schema: SandboxSchema;
  props: Record<string, unknown>;
}
const KitContext = createContext<Ctx>({ schema: { business: { name: "", timezone: "UTC", currency: "CAD" }, tables: [] }, props: {} });
let currentSchema: SandboxSchema = { business: { name: "", timezone: "UTC", currency: "CAD" }, tables: [] };
// Writes from any component bump this, so every useRecords on the page refreshes.
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

// ---------- kit: data ----------

type Query = { table: string; filters?: { field: string; op: string; value?: unknown }[]; sort?: { field: string; dir: "asc" | "desc" }[]; limit?: number; offset?: number };

// The bridge serves at most PAGE rows per call; bigger limits are fetched page by page (up to MAX_ROWS).
const PAGE = 500;
const MAX_ROWS = 5000;
async function listAll(q: Query) {
  const want = Math.min(Math.max(1, Math.floor(Number(q.limit) || 50)), MAX_ROWS);
  const start = Math.max(0, Math.floor(Number(q.offset) || 0));
  if (want <= PAGE) return call<{ records: SandboxRecord[]; total: number }>("records.list", { ...q, limit: want, offset: start });
  const out: SandboxRecord[] = [];
  let total = 0;
  while (out.length < want) {
    const page = await call<{ records: SandboxRecord[]; total: number }>("records.list", { ...q, limit: Math.min(PAGE, want - out.length), offset: start + out.length });
    out.push(...page.records);
    total = page.total;
    if (page.records.length < PAGE || start + out.length >= total) break;
  }
  return { records: out, total };
}

const records = {
  list: (q: Query) => listAll(q),
  get: (table: string, id: string) => call<SandboxRecord>("records.get", table, id),
  create: async (table: string, data: Record<string, unknown>) => {
    const r = await call<SandboxRecord>("records.create", table, data);
    changed();
    return r;
  },
  update: async (table: string, id: string, data: Record<string, unknown>) => {
    const r = await call<SandboxRecord>("records.update", table, id, data);
    changed();
    return r;
  },
  remove: async (table: string, id: string) => {
    const ok = await call<boolean>("records.remove", table, id);
    if (ok) changed();
    return ok;
  },
};

function useRefresh() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const l = () => setN((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return n;
}

function useRecords(query: Query) {
  const key = JSON.stringify(query);
  const tick = useRefresh();
  const [state, setState] = useState<{ records: SandboxRecord[]; total: number; loading: boolean; error: string | null }>({ records: [], total: 0, loading: true, error: null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    records
      .list(JSON.parse(key))
      .then((r) => live && setState({ records: r.records, total: r.total, loading: false, error: null }))
      .catch((e: Error) => live && setState({ records: [], total: 0, loading: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [key, tick, again]);
  return useErrorGuard(state, () => setAgain((x) => x + 1));
}

/**
 * A load error is never shown as an empty list: unless the component reads `error` itself, the
 * error goes to the frame's error card (with Retry), and One App shows it too.
 */
function useErrorGuard<S extends { error: string | null }>(state: S, reload: () => void) {
  const handled = useRef(false);
  if (state.error && !handled.current) throw new Error(state.error);
  const out = { ...state, reload } as S & { reload: () => void };
  Object.defineProperty(out, "error", {
    enumerable: true,
    get: () => {
      // Read lazily by the component during render: remembers that it handles errors itself.
      // eslint-disable-next-line react-hooks/immutability
      handled.current = true;
      return state.error;
    },
  });
  return out;
}

function useRecord(table: string, id: string | null | undefined) {
  const tick = useRefresh();
  const [again, setAgain] = useState(0);
  const [state, setState] = useState<{ record: SandboxRecord | null; loading: boolean; error: string | null }>({ record: null, loading: !!id, error: null });
  useEffect(() => {
    if (!id) return setState({ record: null, loading: false, error: null });
    let live = true;
    records
      .get(table, id)
      .then((r) => live && setState({ record: r, loading: false, error: null }))
      .catch((e: Error) => live && setState({ record: null, loading: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [table, id, tick, again]);
  return useErrorGuard(state, () => setAgain((x) => x + 1));
}

const useSchema = () => useContext(KitContext).schema;
const useProps = () => useContext(KitContext).props;

const tableOf = (id: string) => currentSchema.tables.find((t) => t.id === id);
function recordLabel(table: string, r: SandboxRecord) {
  const t = tableOf(table);
  const f = t?.fields.find((x) => x.id === t.primaryField) ?? t?.fields.find((x) => x.type === "text");
  const v = f ? r.data[f.id] : undefined;
  if (v == null || v === "") return "Untitled";
  return f?.options?.find((o) => o.id === v)?.label ?? String(v);
}
function optionLabel(table: string, field: string, optionId: unknown) {
  const f = tableOf(table)?.fields.find((x) => x.id === field);
  return f?.options?.find((o) => o.id === optionId)?.label ?? (optionId == null ? "" : String(optionId));
}
const navigate = (pageId: string) => void call("navigate", pageId);
/** Opens a record's own page (or its form, for tables that open in a pop-up). */
const openRecord = (table: string, recordId: string) => void call("record.open", table, recordId);
/** "1 tenant", "3 tenants" (or a given plural: plural(n, "person", "people")). */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Add/edit screen as a modal drawn by One App over the whole page. Resolves the saved record, or null if cancelled. */
async function openRecordForm(opts: { table: string; recordId?: string; fields?: string[]; title?: string; submitLabel?: string; defaults?: Record<string, unknown> }) {
  const r = await call<SandboxRecord | null>("form.open", opts);
  // Refresh even when nothing came back: the record may have been deleted from the form.
  changed();
  return r;
}
const toast = (message: string) => void call("toast", message);
function formatMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currentSchema.business.currency || "CAD" }).format(n);
}
function formatDate(iso: string | null | undefined, style: "date" | "datetime" | "time" | "relative" = "date") {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const timeZone = currentSchema.business.timezone || undefined;
  if (style === "relative") {
    const diff = (d.getTime() - Date.now()) / 60000;
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const abs = Math.abs(diff);
    return abs < 60 ? rtf.format(Math.round(diff), "minute") : abs < 1440 ? rtf.format(Math.round(diff / 60), "hour") : rtf.format(Math.round(diff / 1440), "day");
  }
  const o: Intl.DateTimeFormatOptions =
    style === "time" ? { hour: "numeric", minute: "2-digit" } : style === "datetime" ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, { ...o, timeZone: iso.length === 10 ? "UTC" : timeZone }).format(d);
}

// ---------- kit: UI ----------

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
type Kids = { children?: React.ReactNode; className?: string };

function Card({ title, actions, className, children, padded = true }: Kids & { title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cx("rounded-[var(--card-radius)] border border-line bg-card shadow-soft", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          {title && <h2 className="truncate text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={padded ? cx("px-5 pb-5", !(title || actions) && "pt-5") : ""}>{children}</div>
    </section>
  );
}

function Button({ variant = "primary", size = "md", type = "button", disabled, onClick, className, children }: Kids & { variant?: "primary" | "ghost" | "danger" | "link"; size?: "sm" | "md"; type?: "button" | "submit"; disabled?: boolean; onClick?: () => void }) {
  const base = variant === "link" ? "text-accent hover:underline" : cx("inline-flex items-center justify-center gap-2 rounded-[var(--button-radius)] font-semibold transition-colors disabled:opacity-50", size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm");
  const look = variant === "primary" ? "bg-accent text-white hover:bg-accent-hover" : variant === "danger" ? "bg-red-700 text-white hover:bg-red-800" : variant === "ghost" ? "border border-line bg-card text-ink hover:bg-ground" : "";
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cx(base, look, className)}>
      {children}
    </button>
  );
}

function Badge({ color, children, className }: Kids & { color?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full bg-ground px-2.5 py-0.5 text-xs font-medium", className)}>
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

const Chevron = ({ open, className }: { open?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" className={cx("h-4 w-4 transition-transform", open && "rotate-180", className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function Collapsible({ title, defaultOpen = true, actions, className, children }: Kids & { title: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cx("rounded-[var(--card-radius)] border border-line bg-card shadow-soft", className)}>
      <header className="flex items-center gap-3 px-5 py-3.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="ml-auto rounded-full p-1.5 text-muted hover:bg-ground"><Chevron open={open} /></span>
        </button>
        {actions}
      </header>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

function Tabs({ tabs, defaultTab, className }: { tabs: { id: string; label: React.ReactNode; content: React.ReactNode }[]; defaultTab?: string; className?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => setActive(t.id)} className={cx("rounded-[var(--button-radius)] px-4 py-1.5 text-sm", t.id === active ? "bg-accent text-white" : "text-muted hover:bg-ground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.find((t) => t.id === active)?.content}
    </div>
  );
}

const inputCls = "w-full rounded-[min(var(--card-radius),12px)] border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint";
// `popover`: no <label> element, because a click inside a label is forwarded to its first
// button — clicking an option would reopen the dropdown.
const Labelled = ({ label, children, className, popover }: Kids & { label?: React.ReactNode; popover?: boolean }) =>
  label && popover ? (
    <div className={cx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </div>
  ) : label ? (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  ) : (
    <div className={className}>{children}</div>
  );

function Input({ value, onChange, placeholder, type = "text", label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; label?: React.ReactNode; className?: string }) {
  return (
    <Labelled label={label} className={className}>
      <input className={inputCls} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Labelled>
  );
}
function Textarea({ value, onChange, placeholder, rows = 3, label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label?: React.ReactNode; className?: string }) {
  return (
    <Labelled label={label} className={className}>
      <textarea className={inputCls} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Labelled>
  );
}

// Only one dropdown/calendar is open at a time; any click outside, Escape, or a click in the
// app around the frame closes it.
let closeOpenPopover: (() => void) | null = null;
function usePopover() {
  const [open, setOpenState] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closer = useRef<() => void>(() => setOpenState(false));
  const setOpen = useCallback((v: boolean) => {
    if (v) {
      if (closeOpenPopover && closeOpenPopover !== closer.current) closeOpenPopover();
      closeOpenPopover = closer.current;
    } else if (closeOpenPopover === closer.current) closeOpenPopover = null;
    setOpenState(v);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onBlur = () => setOpen(false);
    // Capture phase, so component code that stops propagation can't keep it open.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, setOpen]);
  useEffect(() => () => {
    if (closeOpenPopover === closer.current) closeOpenPopover = null;
  }, []);
  return { open, setOpen, ref };
}

function Select({ value, onChange, options, placeholder = "Choose…", label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; label?: React.ReactNode; className?: string }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.value === value);
  return (
    <Labelled label={label} className={className} popover>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cx(inputCls, "relative truncate pr-11 text-left")}>
          <span className={current ? "" : "text-muted"}>{current?.label ?? placeholder}</span>
          <Chevron open={open} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
        </button>
        {open && (
          <ul role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto rounded-[min(var(--card-radius),16px)] border border-line bg-card p-1.5 shadow-lg">
            {options.map((o) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onChange(o.value);
                }}
                className={cx("cursor-pointer truncate rounded-xl px-3 py-2 text-sm hover:bg-ground", o.value === value && "font-semibold text-accent")}
              >
                {o.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Labelled>
  );
}

// A wall-clock time ("09:30") in the viewer's 12/24-hour style — no timezone shift.
const timeLabel = (t: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`1970-01-01T${t}:00Z`));
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
function DateTimeInput({ value, onChange, withTime = false, label, className }: { value: string; onChange: (v: string) => void; withTime?: boolean; label?: React.ReactNode; className?: string }) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || "09:00";
  const set = (d: string, t: string) => onChange(withTime ? (d ? `${d}T${t}` : "") : d);
  // Calendar grid picker for the date; our Select for the time.
  const { open, setOpen, ref } = usePopover();
  const base = date ? new Date(`${date}T12:00:00`) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const iso = (d: number) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <Labelled label={label} className={className} popover>
      <div className="flex gap-2">
        <div ref={ref} className="relative flex-1">
          <button type="button" onClick={() => setOpen(!open)} className={cx(inputCls, "relative pr-11 text-left")}>
            <span className={date ? "" : "text-muted"}>{date ? formatDate(date) : "Pick a date"}</span>
            <Chevron open={open} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
          </button>
          {open && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-2xl border border-line bg-card p-3 shadow-lg">
              <div className="mb-2 flex items-center">
                <button type="button" className="rounded-full px-2 py-1 hover:bg-ground" onClick={() => setView((v) => ({ y: v.m ? v.y : v.y - 1, m: (v.m + 11) % 12 }))} aria-label="Previous month">‹</button>
                <span className="flex-1 text-center text-sm font-semibold">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first)}</span>
                <button type="button" className="rounded-full px-2 py-1 hover:bg-ground" onClick={() => setView((v) => ({ y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }))} aria-label="Next month">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d}>{d}</span>)}</div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: offset }, (_, i) => <span key={`x${i}`} />)}
                {Array.from({ length: days }, (_, i) => (
                  <button key={i} type="button" onClick={(e) => { e.preventDefault(); setOpen(false); set(iso(i + 1), time); }} className={cx("h-9 rounded-full text-sm", iso(i + 1) === date ? "bg-accent font-semibold text-white" : "hover:bg-ground")}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {withTime && (
          <Select className="w-32" value={time} onChange={(t) => set(date || new Date().toISOString().slice(0, 10), t)} options={TIMES.map((t) => ({ value: t, label: timeLabel(t) }))} />
        )}
      </div>
    </Labelled>
  );
}

function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent", className)} aria-label="Loading" />;
}
function Empty({ children, className }: Kids) {
  return <p className={cx("py-6 text-center text-sm text-muted", className)}>{children ?? "Nothing here yet."}</p>;
}
function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={cx("inline-block", className)} aria-hidden data-icon={name} />;
}

/** Create/edit form for any table, with the right input per field type. */
function RecordForm({ table, fields, recordId, submitLabel = "Save", onSaved, className }: { table: string; fields?: string[]; recordId?: string; submitLabel?: string; onSaved?: (r: SandboxRecord) => void; className?: string }) {
  const schema = useSchema();
  const t = schema.tables.find((x) => x.id === table);
  const { record } = useRecord(table, recordId);
  // A new record starts with each status at its first option (so it shows up on boards).
  const fresh = () => (recordId ? {} : Object.fromEntries((t?.fields ?? []).filter((f) => f.type === "status" && f.options?.length).map((f) => [f.id, f.options![0].id])));
  const [values, setValues] = useState<Record<string, unknown>>(fresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (record) setValues(record.data);
  }, [record]);
  const shown = useMemo(() => {
    const all = (t?.fields ?? []).filter((f) => !["rollup", "formula", "hours"].includes(f.type) && !f.computed);
    return fields ? fields.map((id) => all.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f) : all;
  }, [t, fields]);
  if (!t) return <Empty>Unknown table {table}</Empty>;
  const set = (id: string, v: unknown) => setValues((x) => ({ ...x, [id]: v }));
  const submit = async () => {
    const missing = shown.filter((f) => f.required && f.type !== "checkbox" && (values[f.id] == null || values[f.id] === "" || (Array.isArray(values[f.id]) && !(values[f.id] as unknown[]).length)));
    if (missing.length) return setError(`Please fill in ${missing.map((f) => f.label).join(", ")}.`);
    setBusy(true);
    setError(null);
    try {
      const data = Object.fromEntries(shown.map((f) => [f.id, values[f.id] === "" ? null : (values[f.id] ?? null)]).filter(([, v]) => v !== null || recordId));
      const saved = recordId ? await records.update(table, recordId, data) : await records.create(table, data);
      if (!recordId) setValues(fresh());
      toast(recordId ? "Saved" : `${t.label}: added`);
      onSaved?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={cx("grid gap-3", className)} noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
      {shown.map((f) => (
        <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v) => set(f.id, v)} table={table} />
      ))}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button></div>
    </form>
  );
}

function LinkOptions({ to, render }: { to: string; render: (o: { value: string; label: string }[]) => React.ReactNode }) {
  const { records: rows } = useRecords({ table: to, limit: 200 });
  return <>{render(rows.map((r) => ({ value: r.id, label: recordLabel(to, r) })))}</>;
}

function FieldInput({ field: f, value, onChange, table }: { field: SandboxSchema["tables"][number]["fields"][number]; value: unknown; onChange: (v: unknown) => void; table: string }) {
  const label = <>{f.label}{f.required && <span className="text-accent"> *</span>}</>;
  const str = value == null ? "" : String(value);
  switch (f.type) {
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {f.label}
        </label>
      );
    case "long_text":
      return <Textarea label={label} value={str} onChange={onChange} />;
    case "number":
    case "money":
      return <Input label={label} type="number" value={str} onChange={(v) => onChange(v === "" ? null : Number(v))} />;
    case "date":
      return <DateTimeInput label={label} value={str} onChange={onChange} />;
    case "datetime":
      return <DateTimeInput label={label} value={str ? toLocalInput(str) : ""} onChange={(v) => onChange(v ? new Date(v).toISOString() : null)} withTime />;
    case "status":
    case "choice":
      return <Select label={label} value={str} onChange={onChange} options={(f.options ?? []).map((o) => ({ value: o.id, label: o.label }))} />;
    case "link":
      return f.to ? <LinkOptions to={f.to} render={(opts) => <Select label={label} value={str} onChange={onChange} options={opts} />} /> : null;
    case "file":
      return <FileInput label={label} table={table} field={f.id} value={value} onChange={onChange} multiple={f.multiple} accept={f.multiple || /photo|picture|image|logo|cover|video|before|after/i.test(f.label) ? "image/*,video/*" : "*/*"} />;
    case "email":
      return <Input label={label} type="email" value={str} onChange={onChange} />;
    case "phone":
      return <Input label={label} type="tel" value={str} onChange={onChange} />;
    default:
      return <Input label={label} value={str} onChange={onChange} />;
  }
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- kit: files ----------

type FileValue = { path: string; name: string; size?: number; mime?: string; poster?: string; width?: number; height?: number };
const asFileValue = (v: unknown): FileValue | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === "object" && typeof (x as FileValue).path === "string" && typeof (x as FileValue).name === "string" ? (x as FileValue) : null;
};
/** A file field's value as a list: galleries hold several, single fields one or none. */
const asFileList = (v: unknown): FileValue[] => (Array.isArray(v) ? v : v ? [v] : []).map(asFileValue).filter((f): f is FileValue => !!f);
const isImage = (f: FileValue) => !!f.mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(f.name);
const isVideo = (f: FileValue) => !!f.mime?.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><path d={d} /></svg>
);
const IMAGE_D = "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01";
const FILE_D = "M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6";
const PLUS_D = "M12 5v14M5 12h14";

/** Uploads a file the owner picked into a file field's storage (photos are shrunk, videos get a still); save the result in that field. */
async function uploadFile(table: string, field: string, file: File): Promise<FileValue> {
  return call<FileValue>("files.upload", table, field, file, file.name);
}

// The frame has no network: the host sends the bytes, shown here as blob: URLs (cached per file).
const fileUrls = new Map<string, Promise<string>>();
function fileUrlOf(path: string) {
  let p = fileUrls.get(path);
  if (!p) {
    p = call<Blob>("files.read", path).then((b) => URL.createObjectURL(b));
    p.catch(() => fileUrls.delete(path));
    fileUrls.set(path, p);
  }
  return p;
}
function usePathUrl(path: string | undefined): string | null {
  const [state, setState] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (path) fileUrlOf(path).then((url) => live && setState({ path, url }), () => {});
    return () => {
      live = false;
    };
  }, [path]);
  return state && state.path === path ? state.url : null;
}
/** A viewable URL for a file field's value; for a video, its still frame. */
function useFileUrl(value: unknown): string | null {
  const f = asFileValue(value);
  return usePathUrl(f ? (isVideo(f) ? f.poster : f.path) : undefined);
}
/** Opens a file (a lease, a receipt) in a new tab, from One App. */
function openFile(value: unknown) {
  const f = asFileValue(value);
  if (f) void call("files.open", f.path);
}
/** Shows photos and videos full screen (swipe through; videos play). */
function viewFiles(value: unknown, index = 0) {
  const list = asFileList(value);
  if (list.length) void call("files.view", list, index);
}

/**
 * Shows a file field: the photo itself, a video's still with a play button, or a chip for other
 * files. Tapping opens it full screen. A gallery value shows its first item. Empty: a soft placeholder.
 */
function FileImage({ file, alt = "", className, fit = "cover", onClick }: { file: unknown; alt?: string; className?: string; fit?: "cover" | "contain"; onClick?: () => void }) {
  const f = asFileValue(file);
  const url = useFileUrl(f && (isImage(f) || isVideo(f)) ? f : null);
  const box = className ?? "h-24 w-24 rounded-xl";
  if (!f) return <div className={cx("flex items-center justify-center bg-ground text-muted", box)}><Glyph d={IMAGE_D} className="h-6 w-6" /></div>;
  if (!isImage(f) && !isVideo(f))
    return (
      <button type="button" onClick={() => openFile(f)} className={cx("inline-flex max-w-full items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-ground", className)}>
        <Glyph d={FILE_D} className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate">{f.name}</span>
      </button>
    );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (onClick) onClick(); else viewFiles(file); }} className={cx("relative block overflow-hidden bg-ground", box)} aria-label={`Open ${alt || f.name}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- runs in the sandbox frame, not Next
        <img src={url} alt={alt} className={cx("h-full w-full", fit === "cover" ? "object-cover" : "object-contain")} />
      ) : (
        <span className={cx("block h-full w-full", isVideo(f) && !f.poster ? "bg-ink/80" : "animate-pulse bg-ground")} />
      )}
      {isVideo(f) && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/70 text-white shadow-lg">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      )}
    </button>
  );
}

/** A grid of photos and videos (a gallery field, or several files); tap one to view them all full screen. */
function Gallery({ files, className, itemClassName = "aspect-square w-full rounded-xl", empty }: { files: unknown; className?: string; itemClassName?: string; empty?: React.ReactNode }) {
  const list = asFileList(files);
  if (!list.length) return <>{empty ?? null}</>;
  return (
    <div className={cx("grid grid-cols-3 gap-2 sm:grid-cols-4", className)}>
      {list.map((f, i) => (
        <FileImage key={f.path} file={f} className={itemClassName} onClick={() => viewFiles(list, i)} />
      ))}
    </div>
  );
}

/**
 * The upload control for a file field: tap (a phone offers the camera), drop or paste files.
 * `multiple` for gallery fields — onChange then gets the whole list. Uploads start right away.
 */
function FileInput({ table, field, value, onChange, label, accept = "image/*,video/*", multiple, className }: { table: string; field: string; value: unknown; onChange: (v: FileValue | FileValue[] | null) => void; label?: React.ReactNode; accept?: string; multiple?: boolean; className?: string }) {
  const files = asFileList(value);
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const latestRef = useRef(files);
  useEffect(() => {
    latestRef.current = files;
  });
  const add = async (picked: File[]) => {
    const list = multiple ? picked : picked.slice(0, 1);
    if (!list.length) return;
    setError(null);
    setBusy((b) => b + list.length);
    for (const file of list) {
      try {
        const up = await uploadFile(table, field, file);
        latestRef.current = multiple ? [...latestRef.current, up] : [up];
        onChange(multiple ? latestRef.current : up);
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message.replace(/^[a-z_]+: /, "") : "Upload failed"}`);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
  const remove = (path: string) => {
    latestRef.current = files.filter((f) => f.path !== path);
    onChange(multiple ? latestRef.current : null);
  };
  const media = /image|video/.test(accept);
  return (
    <Labelled label={label} className={className} popover>
      <div
        className={cx("rounded-2xl", over && "bg-accent-tint ring-2 ring-accent")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}
        onPaste={(e) => { const p = [...e.clipboardData.files]; if (p.length) { e.preventDefault(); void add(p); } }}
      >
        <input ref={input} type="file" className="hidden" accept={accept} multiple={multiple} onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {!files.length && !busy ? (
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-sm text-muted hover:border-accent hover:text-accent">
            <Glyph d={IMAGE_D} className="h-6 w-6" />
            <span className="font-semibold text-ink">{media ? (multiple ? "Add photos or videos" : "Add a photo") : "Add a file"}</span>
            <span className="text-xs">Drop here, paste, or tap{media ? " — on a phone you can take one" : ""}</span>
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={f.path} className="relative">
                <FileImage file={f} className="h-20 w-20 rounded-xl" onClick={() => viewFiles(files, i)} />
                <button type="button" onClick={() => remove(f.path)} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white shadow" aria-label={`Remove ${f.name}`}>✕</button>
              </div>
            ))}
            {Array.from({ length: busy }, (_, i) => (
              <div key={`up${i}`} className="flex h-20 w-20 items-center justify-center rounded-xl border border-line bg-ground" aria-label="Uploading"><Spinner /></div>
            ))}
            {(multiple || !files.length) && !(!multiple && busy) && (
              <button type="button" onClick={() => input.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent">
                <Glyph d={PLUS_D} className="h-5 w-5" /> Add
              </button>
            )}
            {!multiple && files.length > 0 && !busy && (
              <button type="button" onClick={() => input.current?.click()} className="self-end text-sm font-medium text-accent hover:underline">Replace</button>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      </div>
    </Labelled>
  );
}

// ---------- kit: board ----------

/**
 * A kanban board whose cards can always be dragged between columns (mouse, touch, pen):
 * dropping saves the card's `field`. Columns default to the field's options. Clicking a card
 * opens its record page unless onCardClick is given.
 */
function Board({ table, field, records: rows, renderCard, columns, onCardClick, className }: { table: string; field: string; records: SandboxRecord[]; renderCard: (r: SandboxRecord) => React.ReactNode; columns?: { id: string; label: string; color?: string }[]; onCardClick?: (r: SandboxRecord) => void; className?: string }) {
  const schema = useContext(KitContext).schema;
  const f = schema.tables.find((t) => t.id === table)?.fields.find((x) => x.id === field);
  const cols = columns ?? (f?.options ?? []).map((o) => ({ id: o.id, label: o.label, color: o.color }));
  const locked = !!f?.computed;
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; w: number; sx: number; sy: number; live: boolean; over?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupOf = (r: SandboxRecord) => moved[r.id] ?? String(r.data[field] ?? "");
  const colAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-col]") as HTMLElement | null)?.dataset.col;
  const drop = async (id: string, to: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r || String(r.data[field] ?? "") === to && !moved[id]) return;
    if (groupOf(r) === to) return;
    setMoved((m) => ({ ...m, [id]: to }));
    try {
      await records.update(table, id, { [field]: to });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^[a-z_]+: /, "") : "Couldn’t move it");
      setTimeout(() => setError(null), 4000);
    } finally {
      setMoved((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }
  };
  const dragged = drag?.live ? rows.find((r) => r.id === drag.id) : undefined;
  return (
    <div className={cx("relative", className)}>
      {locked && <p className="mb-2 text-xs text-muted">{f?.label} follows the dates, so cards move by themselves.</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cols.map((c) => {
          const items = rows.filter((r) => groupOf(r) === c.id);
          return (
            <div key={c.id} data-col={c.id} className={cx("flex w-64 shrink-0 flex-col rounded-2xl p-2 transition-colors", drag?.live && drag.over === c.id ? "bg-accent-tint ring-2 ring-accent/40" : "bg-ground")}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color ?? "var(--color-muted)" }} />
                <span className="truncate text-sm font-semibold">{c.label}</span>
                <span className="ml-auto text-xs text-muted">{items.length}</span>
              </div>
              <div className="min-h-12 space-y-2 p-0.5">
                {items.map((r) => (
                  <div
                    key={r.id}
                    className={cx(!locked && "cursor-grab touch-none select-none", drag?.live && drag.id === r.id && "opacity-30")}
                    onPointerDown={(e) => {
                      if (locked || e.button !== 0) return;
                      e.preventDefault();
                      const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      setDrag({ id: r.id, x: e.clientX, y: e.clientY, dx: e.clientX - b.left, dy: e.clientY - b.top, w: b.width, sx: e.clientX, sy: e.clientY, live: false });
                    }}
                    onPointerMove={(e) => {
                      if (!drag) return;
                      const live = drag.live || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6;
                      if (live) setDrag({ ...drag, x: e.clientX, y: e.clientY, live, over: colAt(e.clientX, e.clientY) });
                    }}
                    onPointerUp={(e) => {
                      const d = drag;
                      setDrag(null);
                      if (!d) return;
                      if (!d.live) return void (onCardClick ? onCardClick(r) : openRecord(table, r.id));
                      const to = colAt(e.clientX, e.clientY);
                      if (to) void drop(r.id, to);
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onClick={() => locked && (onCardClick ? onCardClick(r) : openRecord(table, r.id))}
                  >
                    {renderCard(r)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {dragged && drag && (
        <div className="pointer-events-none fixed z-50 rotate-2 opacity-90 shadow-lg" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {renderCard(dragged)}
        </div>
      )}
      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

const kit = {
  useRecords, useRecord, useSchema, useProps, records, recordLabel, optionLabel, navigate, openRecord, openRecordForm, toast, plural, formatMoney, formatDate,
  uploadFile, useFileUrl, openFile, viewFiles,
  Card, Button, Badge, Collapsible, Tabs, Input, Textarea, Select, DateTimeInput, RecordForm, Spinner, Empty, Icon, FileImage, FileInput, Gallery, Board,
};

// ---------- boot ----------

class Boundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    post({ type: "crash", message: e instanceof Error ? e.message : String(e) });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-1 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">This part couldn’t load.</p>
        <p className="mt-1 break-words">{this.state.error}</p>
        <button type="button" className="mt-3 rounded-full bg-white px-4 py-1.5 font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

const MODULES: Record<string, unknown> = { react: React, "react/jsx-runtime": jsxRuntime, "@one/kit": kit };
function load(compiled: string): React.ComponentType {
  const mod = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!(name in MODULES)) throw new Error(`Can't import ${name}`);
    return MODULES[name];
  };
  new Function("require", "module", "exports", compiled)(require, mod, mod.exports);
  const C = mod.exports.default;
  if (typeof C !== "function") throw new Error("The component has no default export");
  return C as React.ComponentType;
}

function watchHeight() {
  let last = 0;
  // The content's own height (the document is never shorter than the frame, so it can't shrink).
  // scrollHeight includes open dropdowns positioned inside the component.
  const root = document.getElementById("root")!;
  const send = () => {
    const h = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
    if (h !== last) {
      last = h;
      post({ type: "resize", height: h });
    }
  };
  new ResizeObserver(send).observe(root);
  new MutationObserver(send).observe(root, { subtree: true, childList: true, attributes: true });
  send();
}

window.addEventListener("message", (e: MessageEvent<HostToFrame>) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.type === "result") {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(m.error));
  } else if (m?.type === "capture") {
    // A picture of the component for the assistant's self-check. Web fonts can't be fetched from
    // in here (no network), so the picture uses fallback fonts; layout and colours are exact.
    const root = document.getElementById("root")!;
    toJpeg(root, { quality: 0.82, backgroundColor: getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)" ? "#ffffff" : undefined, skipFonts: true, pixelRatio: 1, cacheBust: false })
      .then((dataUrl) => post({ type: "captured", id: m.id, dataUrl }))
      .catch(() => post({ type: "captured", id: m.id, dataUrl: null }));
  } else if (m?.type === "init") {
    currentSchema = m.schema;
    const root = document.getElementById("root")!;
    try {
      const C = load(m.compiled);
      createRoot(root).render(
        <KitContext.Provider value={{ schema: m.schema, props: m.props }}>
          <Boundary>
            <C />
          </Boundary>
        </KitContext.Provider>,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      root.textContent = `This part couldn’t start: ${message}`;
      post({ type: "crash", message });
    }
    if (m.autoHeight) watchHeight();
  }
});
void useCallback;
post({ type: "ready" });
