"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Our dropdown (not the browser's): same look on every device, keyboard friendly, searchable
 * when the list is long. With `name` it also posts its value in a <form>.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  name,
  id,
  multiple = false,
  required,
  className = "",
  ariaLabel,
  searchable,
  size = "md",
}: {
  value: string | string[];
  onChange: (v: string | string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  name?: string;
  id?: string;
  multiple?: boolean;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  searchable?: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; host: Element } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const canSearch = searchable ?? options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    // The list floats above the page (so cards can't clip it) and follows its button.
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 280 && r.top > below;
      // Inside a modal <dialog> (browser top layer) the list must live in the dialog to show above it.
      const host = button.current?.closest("dialog") ?? document.body;
      setPos({ left: r.left, width: Math.max(r.width, 192), host, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const show = () => {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => selected.includes(o.value))));
    setOpen(true);
  };
  const pick = (v: string) => {
    if (multiple) onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    else {
      onChange(v);
      setOpen(false);
      button.current?.focus();
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active].value);
    } else if (e.key === "Tab") setOpen(false);
  };

  const labelText = selected.length
    ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ") || placeholder
    : placeholder;
  const pad = size === "sm" ? "py-1.5 pl-3 pr-10" : "py-2.5 pl-4 pr-11";

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKey}>
      {name && (multiple ? selected.map((v) => <input key={v} type="hidden" name={name} value={v} />) : <input type="hidden" name={name} value={selected[0] ?? ""} />)}
      {/* Lets the browser's "required" check and our server validation still apply. */}
      {required && !selected.length && <input tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" required value="" onChange={() => {}} onFocus={() => button.current?.focus()} />}
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : show())}
        className={`relative w-full truncate rounded-xl border bg-card text-left text-sm outline-none transition-colors ${pad} ${open ? "border-accent ring-2 ring-accent-tint" : "border-line hover:border-ink/25 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-tint"}`}
      >
        <span className={selected.length ? "" : "text-muted"}>{labelText}</span>
        <ChevronDown className={`pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div ref={pop} style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }} className="z-[100] overflow-hidden rounded-2xl border border-line bg-card shadow-lg">
          {canSearch && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search className="h-4 w-4 text-muted" />
              <input
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Search…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                aria-label="Search options"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-multiselectable={multiple} className="max-h-64 overflow-y-auto p-1.5">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
            {shown.map((o, i) => {
              const on = selected.includes(o.value);
              return (
                <li
                  key={o.value || "__empty"}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.value)}
                  ref={(el) => {
                    if (el && i === active) el.scrollIntoView({ block: "nearest" });
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm ${i === active ? "bg-ground" : ""} ${on ? "font-semibold text-accent" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs font-normal text-muted">{o.hint}</span>}
                  </span>
                  {on && <Check className="h-4 w-4 shrink-0" />}
                </li>
              );
            })}
          </ul>
        </div>,
        pos.host,
      )}
    </div>
  );
}

/** Times of day every `stepMin` minutes, labelled in the viewer's 12/24-hour style. */
export function timeOptions(stepMin = 15): SelectOption[] {
  const out: SelectOption[] = [];
  for (let m = 0; m < 24 * 60; m += stepMin) {
    const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`1970-01-01T${v}:00Z`));
    out.push({ value: v, label });
  }
  return out;
}
