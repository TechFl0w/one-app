"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { autoMap, MAX_IMPORT_ROWS, parseCsv, type DateOrder } from "@/import/csv";
import type { Table } from "@/schema/blueprint";
import type { ImportRequest, ImportResult } from "@/app/b/[businessId]/import-actions";
import { isComputedField } from "@/schema/blueprint";

const NEW = "__new__";

/** Bring a spreadsheet in: pick a CSV, choose where it goes, match columns, import. */
export function ImportWizard({ tables, basePath, run }: { tables: Table[]; basePath: string; run: (req: ImportRequest) => Promise<ImportResult> }) {
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [target, setTarget] = useState(NEW);
  const [newName, setNewName] = useState("");
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<ImportResult, { ok: true }> | null>(null);
  const [busy, start] = useTransition();
  const headers = grid?.[0] ?? [];
  const rows = useMemo(() => grid?.slice(1) ?? [], [grid]);
  const table = tables.find((t) => t.id === target);

  const load = async (file: File) => {
    setError(null);
    setResult(null);
    if (!/\.(csv|tsv|txt)$/i.test(file.name) && file.type !== "text/csv") return setError("Save your spreadsheet as CSV first (in Excel or Google Sheets: File → Download / Save as → CSV).");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("That file has no rows under the header.");
    if (parsed.length - 1 > MAX_IMPORT_ROWS) return setError(`Up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time — split the file.`);
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    setFileName(file.name);
    setNewName(base.charAt(0).toUpperCase() + base.slice(1));
    setGrid(parsed);
    // Suggest the existing table whose fields match most columns.
    const best = tables.map((t) => [t, autoMap(parsed[0], t).filter(Boolean).length] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= Math.max(2, Math.ceil(parsed[0].length / 2))) {
      setTarget(best[0].id);
      setMapping(autoMap(parsed[0], best[0]));
    } else setTarget(NEW);
  };
  const pickTarget = (id: string) => {
    setTarget(id);
    const t = tables.find((x) => x.id === id);
    if (t) setMapping(autoMap(headers, t));
  };
  const go = () =>
    start(async () => {
      setError(null);
      const r = await run({ target: table ? { tableId: table.id, mapping } : { newTable: newName }, headers, rows, dateOrder });
      if (r.ok) setResult(r);
      else setError(r.error);
    });

  if (result) {
    const page = result.pageId ?? undefined;
    return (
      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">Imported {result.imported.toLocaleString()} row{result.imported === 1 ? "" : "s"}</h2>
        {result.skipped > 0 && <p className="text-sm text-muted">{result.skipped} row{result.skipped === 1 ? " was" : "s were"} skipped:</p>}
        {result.problems.length > 0 && (
          <ul className="max-h-60 overflow-auto rounded-xl bg-ground px-4 py-2 text-sm">
            {result.problems.map((p, i) => <li key={i}>Row {p.row}{p.field ? ` · ${p.field}` : ""}: {p.message}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          {page && <Link className="btn-primary" href={`${basePath}/p/${page}`}>Open {newName}</Link>}
          <button type="button" className="btn-ghost" onClick={() => { setResult(null); setGrid(null); }}>Import another file</button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <label
        className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-10 text-center hover:bg-ground"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
      >
        {grid ? <FileSpreadsheet className="h-7 w-7 text-accent" /> : <Upload className="h-7 w-7 text-accent" />}
        <span className="font-semibold">{grid ? `${fileName} · ${rows.length.toLocaleString()} rows` : "Drop a CSV file here, or click to choose"}</span>
        <span className="text-sm text-muted">From Excel, Google Sheets, Numbers, or another app’s export.</span>
        <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} aria-label="CSV file" />
      </label>

      {grid && (
        <>
          <section className="card grid gap-4 p-6 sm:grid-cols-2">
            <div>
              <span className="label">Import into</span>
              <Select value={target} onChange={(v) => pickTarget(v as string)} ariaLabel="Import into" options={[{ value: NEW, label: "A new table" }, ...tables.map((t) => ({ value: t.id, label: t.label }))]} />
            </div>
            {target === NEW ? (
              <label className="block"><span className="label">Name of the new table</span><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} /></label>
            ) : <div />}
            <div>
              <span className="label">Dates are written</span>
              <Select value={dateOrder} onChange={(v) => setDateOrder(v as DateOrder)} ariaLabel="Date order" options={[{ value: "mdy", label: "Month first (3/14/2026)" }, { value: "dmy", label: "Day first (14/3/2026)" }]} />
            </div>
          </section>

          {table && (
            <section className="card space-y-3 p-6">
              <h2 className="font-semibold">Match the columns</h2>
              <ul className="space-y-2">
                {headers.map((h, i) => (
                  <li key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <span className="truncate text-sm"><span className="font-medium">{h || `Column ${i + 1}`}</span> <span className="text-muted">e.g. {rows.find((r) => r[i]?.trim())?.[i]?.slice(0, 40) ?? "—"}</span></span>
                    <span className="hidden text-muted sm:block">→</span>
                    <Select
                      value={mapping[i] ?? ""}
                      onChange={(v) => setMapping((m) => m.map((x, j) => (j === i ? (v as string) || null : x)))}
                      ariaLabel={`Field for ${h}`}
                      options={[{ value: "", label: "Don’t import" }, ...table.fields.filter((f) => !isComputedField(f) && !["file", "hours", "person"].includes(f.type)).map((f) => ({ value: f.id, label: f.label }))]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted"><tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-b border-line/60">{headers.map((_, j) => <td key={j} className="max-w-48 truncate px-4 py-2">{r[j]}</td>)}</tr>)}</tbody>
            </table>
            {rows.length > 5 && <p className="px-4 py-2 text-xs text-muted">…and {(rows.length - 5).toLocaleString()} more</p>}
          </section>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || (target === NEW && !newName.trim())} onClick={go}>
              {busy ? "Importing…" : `Import ${rows.length.toLocaleString()} rows`}
            </button>
            <p className="text-sm text-muted">Imports don’t trigger automations.</p>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
