import type { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { applyChangeSet } from "@/engine/changeSet";
import { errorResult, okResult } from "@/engine/commit";
import { buildRecordQuery, linkedIds, projectData, RecordError, tableOrThrow, validateRecordInput } from "@/engine/records";
import { memoryQuery } from "@/engine/store";
import { addComputed, queryWithComputed } from "@/engine/computed";
import type { OwnerBackend } from "./types";
import { recordUpdateIsRisky } from "@/engine/risk";

/** OwnerBackend over in-memory state, with the same validation as the real one. Demo + tests. */
export function memoryBackend(initial: { blueprint: Blueprint; records: RecordRow[] }, newId = () => crypto.randomUUID()) {
  const state = { blueprint: initial.blueprint, records: [...initial.records] };
  const find = (tableId: string, id: string) => {
    const r = state.records.find((x) => x.tableId === tableId && x.id === id);
    if (!r) throw new RecordError("not_found", "Record not found");
    return r;
  };
  const view = (r: RecordRow): RecordRow => ({ ...r, data: projectData(tableOrThrow(state.blueprint, r.tableId), r.data) });
  const checkLinks = (tableId: string, data: Record<string, unknown>) => {
    for (const [target, ids] of linkedIds(tableOrThrow(state.blueprint, tableId), data)) {
      for (const id of ids) find(target, id);
    }
  };

  const computed = (bp: Blueprint, t: string, rows: RecordRow[]) => addComputed(bp, t, rows, async (table) => state.records.filter((r) => r.tableId === table).map(view));

  const backend: OwnerBackend = {
    blueprint: async () => state.blueprint,
    query: async (q) =>
      queryWithComputed(state.blueprint, q, async (sq) => {
        const { records, total } = memoryQuery(state.records, buildRecordQuery(state.blueprint, sq));
        return { records: records.map(view), total };
      }, async (table) => state.records.filter((r) => r.tableId === table).map(view)),
    getRecord: async (t, id) => (await computed(state.blueprint, t, [view(find(t, id))]))[0],
    createRecord: async (t, input) => {
      const data = validateRecordInput(tableOrThrow(state.blueprint, t), input, "create");
      checkLinks(t, data);
      const now = new Date().toISOString();
      const row: RecordRow = { id: newId(), tableId: t, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)), createdAt: now, updatedAt: now };
      state.records.push(row);
      return view(row);
    },
    updateRecord: async (t, id, input, opts = {}) => {
      const patch = validateRecordInput(tableOrThrow(state.blueprint, t), input, "update");
      if (recordUpdateIsRisky(tableOrThrow(state.blueprint, t), patch) && !opts.confirmed) {
        throw new RecordError("needs_confirmation", "Changing a price or amount needs confirmation");
      }
      checkLinks(t, patch);
      const row = find(t, id);
      const data = { ...row.data, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === null) delete data[k];
      row.data = data;
      row.updatedAt = new Date().toISOString();
      return view(row);
    },
    deleteRecord: async (t, id) => {
      find(t, id);
      state.records = state.records.filter((r) => !(r.tableId === t && r.id === id));
    },
    commitChangeSet: async (cs, confirmed) => {
      try {
        const r = applyChangeSet(state.blueprint, cs, { confirmed });
        state.blueprint = r.blueprint;
        return okResult(r, { inverse: r.inverse });
      } catch (e) {
        return errorResult(e);
      }
    },
  };
  return { backend, state };
}
