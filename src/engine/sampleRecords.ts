import type { Blueprint, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { isComputedField } from "@/schema/blueprint";

/**
 * Made-up records for any setup, so an app can be looked at without its owner's data (the control
 * center's previews). Deterministic: the same setup always gets the same sample.
 */

const NAMES = ["Alex Morgan", "Priya Shah", "Sam Okafor", "Lee Park", "Dana Ruiz", "Tom Becker", "Ana Lima", "Mai Tran"];
const WORDS = ["Kitchen refresh", "Spring service", "Gel manicure", "Panel upgrade", "Weekly visit", "Front brakes", "Garden cleanup", "Consultation"];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function valueFor(f: Field, table: Table, i: number, r: () => number, today: Date, ids: Map<string, string[]>): unknown {
  const day = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const label = f.label.toLowerCase();
  switch (f.type) {
    case "text":
      if (/name|client|customer|contact/.test(label) || (f.id === table.primaryField && /client|customer|people|member|team|staff|tenant|guest|patient|student/i.test(table.label))) return NAMES[i % NAMES.length];
      if (/plate/.test(label)) return `BC ${Math.floor(r() * 9)}${"KRTLM"[i % 5]}${"XQZ"[i % 3]} ${10 + Math.floor(r() * 89)}`;
      if (/address|site|location/.test(label)) return `${10 + Math.floor(r() * 300)} ${["Maple", "Oak", "Birch", "Cedar"][i % 4]} Street`;
      if (/#|number|code|ref/.test(label)) return `${i + 1001}`;
      return f.id === table.primaryField ? `${WORDS[(i + hash(table.id)) % WORDS.length]}` : `${f.label} ${i + 1}`;
    case "long_text":
      return i % 2 ? `Notes about ${WORDS[i % WORDS.length].toLowerCase()}.` : undefined;
    case "number": {
      const lo = "min" in f && typeof f.min === "number" ? f.min : 1;
      const hi = "max" in f && typeof f.max === "number" ? f.max : lo + 20;
      return /year/.test(label) ? Math.round(Math.min(hi, Math.max(lo, 2012 + r() * 12))) : Math.round((lo + r() * Math.min(20, hi - lo)) * 10) / 10;
    }
    case "money":
      return Math.round(20 + r() * 480);
    case "checkbox":
      return r() > 0.5;
    case "date":
      return day(Math.round(r() * 20) - 8);
    case "datetime": {
      const d = new Date(today.getTime() + (Math.round(r() * 6) - 2) * 86_400_000);
      d.setUTCHours(15 + (i % 6), 0, 0, 0);
      return d.toISOString();
    }
    case "phone":
      return `+1 604 555 01${String(10 + i).slice(-2)}`;
    case "email":
      return `${NAMES[i % NAMES.length].split(" ")[0].toLowerCase()}@example.com`;
    case "status":
    case "choice":
      if ("derive" in f && f.derive) return undefined;
      return f.multiple ? [f.options[i % f.options.length].id] : f.options[(i + Math.floor(r() * 2)) % f.options.length].id;
    case "link": {
      const pool = ids.get(f.to) ?? [];
      if (!pool.length) return undefined;
      return f.multiple ? [pool[i % pool.length]] : pool[(i * 3 + 1) % pool.length];
    }
    default:
      return undefined;
  }
}

/** Sample rows for every table: `perTable` each, linked to each other, dated around `today`. */
export function sampleRecords(bp: Blueprint, today = new Date(), perTable = 5): RecordRow[] {
  const r = rng(hash(bp.business.name + bp.tables.map((t) => t.id).join()));
  const ids = new Map<string, string[]>();
  let n = 0;
  for (const t of bp.tables) ids.set(t.id, Array.from({ length: perTable }, () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`));
  const at = new Date(today.getTime() - 7 * 86_400_000).toISOString();
  const rows: RecordRow[] = [];
  for (const t of bp.tables) {
    ids.get(t.id)!.forEach((id, i) => {
      const data: Record<string, unknown> = {};
      for (const f of t.fields) {
        if (isComputedField(f) || f.type === "file" || f.type === "hours" || f.type === "person") continue;
        const v = valueFor(f, t, i, r, today, ids);
        if (v !== undefined) data[f.id] = v;
      }
      rows.push({ id, tableId: t.id, data, createdAt: at, updatedAt: at });
    });
  }
  return rows;
}
