import type { Blueprint, Field, Table } from "@/schema/blueprint";

/**
 * Data rules checked on a whole setup (docs/data-rules.md): the traps that made real apps act on
 * stale facts — statuses that drift from their dates, messages sent to people who already left.
 * Findings go back to the assistant after every setup change and show in the setup summary.
 */
export function checkDataRules(bp: Blueprint): string[] {
  const out: string[] = [];
  const table = (id?: string) => bp.tables.find((t) => t.id === id);
  const isStatusLike = (f: Field) => f.type === "status" || f.type === "choice" || f.type === "checkbox";
  const derived = (f?: Field) => !!f && "derive" in f && !!f.derive;

  // 1. A status that only describes where the dates are should follow them (derive), not be stored.
  const LIFECYCLE = /^(upcoming|future|scheduled|active|current|ongoing|ending|ending soon|ended|expired|past|finished|overdue|late|due)$/i;
  for (const t of bp.tables) {
    if (!t.fields.some((f) => f.type === "date" || f.type === "datetime")) continue;
    for (const f of t.fields) {
      if ((f.type !== "status" && f.type !== "choice") || derived(f)) continue;
      const phases = f.options.filter((o) => LIFECYCLE.test(o.label.trim()));
      if (phases.length >= 2)
        out.push(`${t.label} › ${f.label} (${f.id}) has options like ${phases.slice(0, 3).map((o) => `“${o.label}”`).join(", ")} that just say where the dates are. Make it follow the dates (derive rules) so it can never drift; keep a separate stored field for things people decide (cancelled, on hold).`);
    }
  }

  // 0. Every table needs a readable title: links and ids make pickers and lists unreadable.
  for (const t of bp.tables) {
    const title = t.fields.find((f) => f.id === t.primaryField) ?? t.fields.find((f) => f.type === "text");
    // Text, contact details, a link (shown as the linked record's name) or a choice (its label) all read well.
    if (!title || !["text", "email", "phone", "link", "status", "choice"].includes(title.type))
      out.push(`${t.label} has no readable title${title ? ` (${title.label} is a ${title.type})` : ""}. Add a short text field people recognise it by (e.g. “Maya — Room 1”) and make it the title field.`);
  }

  for (const a of bp.automations) {
    if (!a.enabled) continue;
    const t = table(a.trigger.table);
    if (!t) continue;
    const field = t.fields.find((f) => f.id === a.trigger.field);
    const sends = a.actions.some((x) => x.type === "send_message");
    const waits = a.actions.some((x) => x.type === "wait");

    // 2. Derived values never "change" through an edit, so these triggers would never fire.
    if ((a.trigger.type === "status_changed" || a.trigger.type === "record_updated") && derived(field))
      out.push(`Automation “${a.label}” starts when ${field!.label} changes, but that status follows dates and is never edited, so it would never start. Use a date trigger on the date it follows instead.`);

    // 3. Moving a status along on a date is the drift trap: if a run is missed, the status is wrong.
    if (a.trigger.type === "date_reached") {
      const setsStatus = a.actions.some((x) => (x.type === "update_record" || x.type === "assign") && Object.keys((x.values as object) ?? (x.field ? { [String(x.field)]: 1 } : {})).some((id) => t.fields.find((f) => f.id === id)?.type === "status"));
      if (setsStatus) out.push(`Automation “${a.label}” moves a status along when a date arrives. Make that status follow the date instead (derive rules) — then it's right even when no automation ran.`);
    }

    // 4. Before messaging someone later, check they still qualify (moved out, cancelled, paid…).
    if (sends && (a.trigger.type === "date_reached" || waits) && t.fields.some((f) => f.type === "status") && !a.conditions.some((c) => { const f = t.fields.find((x) => x.id === c.field); return !!f && isStatusLike(f); }))
      out.push(`Automation “${a.label}” messages people ${a.trigger.type === "date_reached" ? "on a date" : "after a wait"} without checking they still qualify. Add a condition such as ${statusExample(t, a.trigger.type === "status_changed" ? a.trigger : undefined)} — it's checked again right before sending, so nobody who left, cancelled or already paid gets it.`);
  }
  return [...new Set(out)];
}

function statusExample(t: Table, trigger?: { field?: string; to?: unknown }): string {
  const f = t.fields.find((x) => x.id === trigger?.field) ?? t.fields.find((x) => x.type === "status") ?? t.fields.find((x) => x.type === "choice");
  if (f && "options" in f) {
    // After "changes to Done", the check is "still Done".
    const o = f.options.find((x) => x.id === trigger?.to) ?? f.options.find((x) => /active|current|booked|open|confirmed/i.test(x.label)) ?? f.options[0];
    return `${f.label} is “${o.label}” (${f.id} eq ${o.id})`;
  }
  return "a status check";
}

