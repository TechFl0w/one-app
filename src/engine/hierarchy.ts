/**
 * Hierarchy: when two linked things belong together, choosing one narrows the other. An
 * appointment links to an owner and a pet, and a pet links to its owner — so the pet picker
 * only shows the chosen owner's pets, and choosing a pet fills in its owner. Worked out from the
 * setup itself; a link field's `narrowBy` overrides it (or turns it off with false).
 */

type F = { id: string; type: string; label?: string; to?: string; multiple?: boolean; narrowBy?: false | { field: string; via: string } };
type T = { id: string; primaryField?: string; fields: F[] };

export interface Narrowing {
  /** The field on this form that narrows (the owner). */
  parent: string;
  /** The field on the child's table that points at the parent (the pet's owner). */
  via: string;
}

/** For each link field in `fieldIds`, the field on the same form that narrows it. */
export function narrowings(tables: T[], tableId: string, fieldIds?: string[]): Record<string, Narrowing> {
  const t = tables.find((x) => x.id === tableId);
  if (!t) return {};
  const links = t.fields.filter((f) => f.type === "link" && f.to && (!fieldIds || fieldIds.includes(f.id)));
  const out: Record<string, Narrowing> = {};
  for (const child of links) {
    const nb = child.narrowBy;
    if (nb === false) continue;
    if (nb) {
      if (links.some((l) => l.id === nb.field)) out[child.id] = { parent: nb.field, via: nb.via };
      continue;
    }
    const childTable = tables.find((x) => x.id === child.to);
    if (!childTable) continue;
    for (const parent of links) {
      if (parent === child || parent.to === child.to || parent.multiple) continue;
      // The child's own link to the parent's table; a single link (a pet has one owner) first.
      const vias = childTable.fields.filter((f) => f.type === "link" && f.to === parent.to);
      const via = vias.find((f) => !f.multiple) ?? vias[0];
      if (!via) continue;
      // Both ways (each links to the other)? Only the side with a single link is the child.
      const back = tables.find((x) => x.id === parent.to)?.fields.find((f) => f.type === "link" && f.to === child.to && !f.multiple);
      if (back && via.multiple) continue;
      out[child.id] = { parent: parent.id, via: via.id };
      break;
    }
  }
  // Never both ways round on one form.
  for (const [c, n] of Object.entries(out)) if (out[n.parent]?.parent === c) delete out[n.parent];
  return out;
}

/** The record's own link to what it belongs to (a pet's owner, a room's building), if any. */
export function parentFieldOf(tables: T[], tableId: string): F | undefined {
  const t = tables.find((x) => x.id === tableId);
  if (!t) return undefined;
  const primary = t.fields.find((f) => f.id === t.primaryField);
  if (!primary || primary.type === "link") return undefined;
  return t.fields.find((f) => f.type === "link" && !f.multiple && f.to && f.to !== t.id);
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)]);

/** Does this child record belong to the chosen parent(s)? */
export const belongsTo = (child: { data: Record<string, unknown> }, via: string, parent: unknown) => {
  const want = ids(parent);
  return !want.length || ids(child.data[via]).some((x) => want.includes(x));
};

/** The parent a chosen child implies (choosing a pet fills in its owner). */
export const impliedParent = (child: { data: Record<string, unknown> } | undefined, via: string): string | undefined => ids(child?.data[via])[0];
