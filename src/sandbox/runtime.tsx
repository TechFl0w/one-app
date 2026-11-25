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

const records = {
  list: (q: Query) => call<{ records: SandboxRecord[]; total: number }>("records.list", q),
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
  return { ...state, reload: () => setAgain((x) => x + 1) };
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
  return { ...state, reload: () => setAgain((x) => x + 1) };
}

const useSchema = () => useContext(KitContext).schema;
const useProps = () => useContext(KitContext).props;

const tableOf = (id: string) => currentSchema.tables.find((t) => t.id === id);
function recordLabel(table: string, r: SandboxRecord) {
  const t = tableOf(table);
  const f = t?.fields.find((x) => x.id === t.primaryField) ?? t?.fields.find((x) => x.type === "text");
  const v = f ? r.data[f.id] : undefined;
  return v == null || v === "" ? "Untitled" : String(v);
}
function optionLabel(table: string, field: string, optionId: unknown) {
  const f = tableOf(table)?.fields.find((x) => x.id === field);
  return f?.options?.find((o) => o.id === optionId)?.label ?? (optionId == null ? "" : String(optionId));
}
const navigate = (pageId: string) => void call("navigate", pageId);
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
const Labelled = ({ label, children, className }: Kids & { label?: React.ReactNode }) =>
  label ? (
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

function Select({ value, onChange, options, placeholder = "Choose…", label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; label?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <Labelled label={label} className={className}>
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
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
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
  const [open, setOpen] = useState(false);
  const base = date ? new Date(`${date}T12:00:00`) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const iso = (d: number) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <Labelled label={label} className={className}>
      <div className="flex gap-2">
        <div className="relative flex-1">
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
                  <button key={i} type="button" onClick={() => { set(iso(i + 1), time); setOpen(false); }} className={cx("h-9 rounded-full text-sm", iso(i + 1) === date ? "bg-accent font-semibold text-white" : "hover:bg-ground")}>
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
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (record) setValues(record.data);
  }, [record]);
  const shown = useMemo(() => {
    const all = (t?.fields ?? []).filter((f) => !["rollup", "formula", "file", "hours"].includes(f.type));
    return fields ? fields.map((id) => all.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f) : all.slice(0, 8);
  }, [t, fields]);
  if (!t) return <Empty>Unknown table {table}</Empty>;
  const set = (id: string, v: unknown) => setValues((x) => ({ ...x, [id]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = Object.fromEntries(shown.map((f) => [f.id, values[f.id] === "" ? null : (values[f.id] ?? null)]).filter(([, v]) => v !== null || recordId));
      const saved = recordId ? await records.update(table, recordId, data) : await records.create(table, data);
      if (!recordId) setValues({});
      toast(recordId ? "Saved" : `${t.label}: added`);
      onSaved?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={cx("grid gap-3", className)} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {shown.map((f) => (
        <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v) => set(f.id, v)} />
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

function FieldInput({ field: f, value, onChange }: { field: SandboxSchema["tables"][number]["fields"][number]; value: unknown; onChange: (v: unknown) => void }) {
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

const kit = {
  useRecords, useRecord, useSchema, useProps, records, recordLabel, optionLabel, navigate, toast, formatMoney, formatDate,
  Card, Button, Badge, Collapsible, Tabs, Input, Textarea, Select, DateTimeInput, RecordForm, Spinner, Empty, Icon,
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
    return this.state.error ? <Empty>Something went wrong in this part: {this.state.error}</Empty> : this.props.children;
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
