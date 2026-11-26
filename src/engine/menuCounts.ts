import type { Blueprint } from "@/schema/blueprint";
import type { RecordStore } from "./store";
import { aggregateOf } from "./blockData";
import { RecordError, type QueryContext } from "./records";

export type MenuCount = { value: number; label?: string; tone?: string };

/** The live numbers next to pages in the menu (page.badge); zero hides the badge. */
export async function menuCounts(bp: Blueprint, store: RecordStore, ctx: QueryContext = {}): Promise<Record<string, MenuCount>> {
  const out: Record<string, MenuCount> = {};
  await Promise.all(
    bp.pages.map(async (p) => {
      if (!p.badge || p.hidden || p.recordOf) return;
      try {
        const value = await aggregateOf(bp, store, p.badge.source, ctx);
        if (value) out[p.id] = { value: Math.round(value), label: p.badge.label, tone: p.badge.tone };
      } catch (e) {
        if (!(e instanceof RecordError)) throw e;
      }
    }),
  );
  return out;
}
