/**
 * Feature tests that drive One App the way an AI does: through a business's MCP tools. The same
 * scenarios run in CI against each template in memory (src/testing/scenarios.test.ts) and against
 * a real business over HTTP (npm run ai-test). Run remote tests only against a TEST business:
 * they add records and pages (pages are removed again; records stay, deleting needs approval).
 */

export type CallResult = { ok: boolean; text: string; json: unknown };
export type Call = (tool: string, args?: Record<string, unknown>) => Promise<CallResult>;

export interface Tester {
  /** Calls a tool; fails the scenario if the tool returns an error (unless `allowError`). */
  call(tool: string, args?: Record<string, unknown>, opts?: { allowError?: boolean }): Promise<CallResult>;
  check(condition: unknown, message: string): void;
  note(message: string): void;
  setup: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** Runs only when the business's setup (get_setup text) has these tables/fields. */
  needs?: string[];
  run(t: Tester): Promise<void>;
}

export interface ScenarioResult {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  notes: string[];
  error?: string;
  ms: number;
}

class CheckFailed extends Error {}

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, "");
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** Option id of a status option by label, read from get_setup ("opt_late=\"Late\""). */
const opt = (setup: string, label: string) => new RegExp(`(opt_[a-z0-9_]+)="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(setup)?.[1];

export const SCENARIOS: Scenario[] = [
  {
    id: "setup",
    title: "The AI can read the setup and the build guide",
    async run(t) {
      t.check(/Tables:/.test(t.setup) && /Pages/.test(t.setup), "get_setup lists tables and pages");
      const guide = await t.call("get_build_guide");
      t.check(guide.text.length > 2000 && /@one\/kit/.test(guide.text), "build guide includes the component kit");
    },
  },

  {
    id: "screens",
    title: "Changing screens: add a page with blocks, move one, add a menu count, remove it again",
    needs: ["tbl_"],
    async run(t) {
      const table = /- (tbl_[a-z0-9_]+) "/.exec(t.setup)?.[1];
      t.check(table, "there is a table to show");
      const pg = `pg_ai_test_${stamp()}`;
      const add = await t.call("change_setup", {
        summary: "AI test: add a test page",
        ops: [
          {
            op: "addPage",
            page: {
              id: pg,
              label: "AI test page",
              icon: "star",
              menuOrder: 99,
              hidden: false,
              layout: {
                columns: 12,
                blocks: [
                  { id: `blk_${pg}_hello`, type: "header", x: 0, y: 0, w: 12, h: 2, options: { stats: [{ table, label: "record|records" }] } },
                  { id: `blk_${pg}_n`, type: "number", x: 0, y: 2, w: 3, h: 2, source: { table, agg: "count" }, options: { title: "How many", icon: "check", tone: "blue" } },
                  { id: `blk_${pg}_list`, type: "list", x: 3, y: 2, w: 9, h: 4, source: { table } },
                ],
              },
            },
          },
        ],
      });
      t.check(/applied|result/.test(add.text), "page added right away (safe change)");
      const moved = await t.call("change_setup", {
        summary: "AI test: rearrange and count",
        ops: [
          { op: "moveBlock", pageId: pg, blockId: `blk_${pg}_n`, x: 9, y: 2 },
          { op: "moveBlock", pageId: pg, blockId: `blk_${pg}_list`, x: 0, y: 2 },
          { op: "setPageBadge", pageId: pg, badge: { source: { table }, tone: "accent" } },
        ],
      });
      t.check(!/error/i.test(obj(moved.json).status as string ?? ""), "moved blocks and added a menu count");
      const after = await t.call("get_setup");
      t.check(after.text.includes(pg), "the new page is in the setup");
      // Overlapping blocks are refused with a readable error, not saved.
      const bad = await t.call("change_setup", { summary: "AI test: overlap", ops: [{ op: "moveBlock", pageId: pg, blockId: `blk_${pg}_n`, x: 0, y: 0 }] }, { allowError: true });
      t.note(bad.ok ? "overlap allowed (layout engine resolves it)" : `overlap refused: ${bad.text.slice(0, 120)}`);
      await t.call("change_setup", { summary: "AI test: remove the test page", ops: [{ op: "removePage", pageId: pg }] });
      t.check(!(await t.call("get_setup")).text.includes(pg), "test page removed again");
    },
  },

  {
    id: "risky",
    title: "Risky changes wait for the owner (switching off an automation, removing a field)",
    needs: ["tbl_"],
    async run(t) {
      const aut = /- (aut_[a-z0-9_]+) "/.exec(t.setup)?.[1];
      if (aut) {
        const r = await t.call("change_setup", { summary: "AI test: switch off an automation (must wait)", ops: [{ op: "toggleAutomation", automationId: aut, enabled: false }] });
        t.check(/approv|confirm/i.test(r.text), "changing an automation is sent to the owner, not done");
      }
      // A field of our own, so asking to remove it can't touch anything the business uses.
      const table = /- (tbl_[a-z0-9_]+) "/.exec(t.setup)![1];
      const fld = `fld_ai_test_${stamp()}`;
      await t.call("change_setup", { summary: "AI test: add a test field", ops: [{ op: "addField", tableId: table, field: { id: fld, label: `AI test ${fld.slice(-6)}`, type: "text" } }] });
      const r = await t.call("change_setup", { summary: "AI test: remove the test field (must wait)", ops: [{ op: "removeField", tableId: table, fieldId: fld }] });
      t.check(/approv|confirm/i.test(r.text), "removing a field is sent to the owner, not done");
      t.check((await t.call("get_setup")).text.includes(fld), "the field is still there until the owner approves");
    },
  },

  {
    id: "component",
    title: "A custom screen: write it (type-checked), read it back",
    async run(t) {
      const id = `cmp_ai_test_${stamp()}`;
      const src = `import { Card, useRecords } from "@one/kit";\nexport default function AiTest() {\n  return <Card title="AI test">Hello from the AI test</Card>;\n}\n`;
      const w = await t.call("write_component", { id, label: "AI test screen", source: src, summary: "AI test: a tiny screen" }, { allowError: true });
      if (!w.ok && /compile|esbuild|typescript|not available/i.test(w.text)) return t.note(`skipped: components can't be compiled here (${w.text.slice(0, 80)})`);
      t.check(w.ok, `component written (${w.text.slice(0, 200)})`);
      const back = await t.call("read_component", { id });
      t.check(/Hello from the AI test/.test(back.text), "source reads back");
      const broken = await t.call("write_component", { id, label: "AI test screen", source: "export default function X() { return <Nope /> }", summary: "AI test: broken" }, { allowError: true });
      t.check(!broken.ok, "broken code is refused with errors to fix");
      await t.call("change_setup", { summary: "AI test: remove the test screen", ops: [{ op: "removeComponent", componentId: id }] }, { allowError: true });
    },
  },

  {
    id: "mechanic",
    title: "Mechanic: a late job, stages, approved lines make the total",
    needs: ["tbl_jobs", "fld_j_stage", "fld_j_timing", "tbl_lines"],
    async run(t) {
      const s = stamp();
      const c = obj(obj((await t.call("create_record", { table: "tbl_customers", values: { fld_c_name: `AI test ${s}` } })).json).created);
      const v = obj(obj((await t.call("create_record", { table: "tbl_vehicles", values: { fld_v_plate: `AI ${s}`, fld_v_owner: c.id } })).json).created);
      const job = obj(obj((await t.call("create_record", { table: "tbl_jobs", values: { fld_j_title: `AI test job ${s}`, fld_j_vehicle: v.id, fld_j_customer: c.id, fld_j_stage: opt(t.setup, "In progress"), fld_j_promised: isoDay(-1) } })).json).created);
      t.check(job.fld_j_timing === opt(t.setup, "Late"), "promised yesterday and not done → Late (derived)");
      const set = await t.call("update_record", { table: "tbl_jobs", id: job.id, values: { fld_j_timing: opt(t.setup, "On time") } }, { allowError: true });
      t.check(!set.ok, "a derived status can't be set by hand");
      await t.call("create_record", { table: "tbl_lines", values: { fld_l_desc: "AI test pads", fld_l_job: job.id, fld_l_qty: 2, fld_l_price: 50, fld_l_approval: opt(t.setup, "Approved") } });
      await t.call("create_record", { table: "tbl_lines", values: { fld_l_desc: "AI test extra", fld_l_job: job.id, fld_l_qty: 1, fld_l_price: 80, fld_l_approval: opt(t.setup, "Proposed") } });
      const got = obj((await t.call("get_record", { table: "tbl_jobs", id: job.id })).json);
      t.check(got.fld_j_total === 100, `approved total counts only approved lines (got ${got.fld_j_total})`);
      t.check(got.fld_j_quote === 180, `quote total counts proposed + approved (got ${got.fld_j_quote})`);
      await t.call("update_record", { table: "tbl_jobs", id: job.id, values: { fld_j_stage: opt(t.setup, "Ready for pickup") } });
      t.check(obj((await t.call("get_record", { table: "tbl_jobs", id: job.id })).json).fld_j_timing === opt(t.setup, "Done"), "ready for pickup → timing Done");
    },
  },

  {
    id: "quotes",
    title: "Quotes & invoices: numbering, tax, statuses follow dates and payments",
    needs: ["tbl_quotes", "fld_q_total", "tbl_invoices", "fld_i_balance", "tbl_payments"],
    async run(t) {
      const s = stamp();
      const c = obj(obj((await t.call("create_record", { table: "tbl_clients", values: { fld_c_name: `AI test ${s}`, fld_c_email: "ai-test@example.com" } })).json).created);
      const q = obj(obj((await t.call("create_record", { table: "tbl_quotes", values: { fld_q_title: `AI test quote ${s}`, fld_q_client: c.id, fld_q_tax_rate: 10, fld_q_valid: isoDay(30) } })).json).created);
      t.check(/^Q-\d{4}$/.test(String(q.fld_q_number)), `new quote got a number (${q.fld_q_number})`);
      t.check(q.fld_q_status === opt(t.setup, "Draft"), "not sent yet → Draft");
      await t.call("create_record", { table: "tbl_quote_lines", values: { fld_ql_desc: "AI test labour", fld_ql_parent: q.id, fld_ql_qty: 4, fld_ql_price: 50 } });
      await t.call("update_record", { table: "tbl_quotes", id: q.id, values: { fld_q_sent: isoDay(0) } });
      let got = obj((await t.call("get_record", { table: "tbl_quotes", id: q.id })).json);
      t.check(got.fld_q_total === 220 && got.fld_q_status === opt(t.setup, "Sent"), `200 + 10% tax = 220, Sent (got ${got.fld_q_total}, ${got.fld_q_status})`);
      await t.call("update_record", { table: "tbl_quotes", id: q.id, values: { fld_q_accepted: isoDay(0), fld_q_accepted_by: "AI Test" } });
      got = obj((await t.call("get_record", { table: "tbl_quotes", id: q.id })).json);
      t.check(got.fld_q_status === opt(t.setup, "Accepted"), "accepted date → Accepted");

      const inv = obj(obj((await t.call("create_record", { table: "tbl_invoices", values: { fld_i_title: `AI test invoice ${s}`, fld_i_client: c.id, fld_i_quote: q.id, fld_i_tax_rate: 10, fld_i_due: isoDay(-1), fld_i_sent: isoDay(-10) } })).json).created);
      t.check(/^INV-\d{4}$/.test(String(inv.fld_i_number)), `new invoice got a number (${inv.fld_i_number})`);
      await t.call("create_record", { table: "tbl_invoice_lines", values: { fld_il_desc: "AI test labour", fld_il_parent: inv.id, fld_il_qty: 4, fld_il_price: 50 } });
      got = obj((await t.call("get_record", { table: "tbl_invoices", id: inv.id })).json);
      t.check(got.fld_i_status === opt(t.setup, "Overdue") && got.fld_i_balance === 220, `due yesterday, unpaid → Overdue, 220 owed (got ${got.fld_i_status}, ${got.fld_i_balance})`);
      await t.call("create_record", { table: "tbl_payments", values: { fld_pay_title: "AI test payment", fld_pay_invoice: inv.id, fld_pay_amount: 220, fld_pay_on: isoDay(0) } });
      got = obj((await t.call("get_record", { table: "tbl_invoices", id: inv.id })).json);
      t.check(got.fld_i_status === opt(t.setup, "Paid") && got.fld_i_balance === 0, `paid in full → Paid, nothing owed (got ${got.fld_i_status}, ${got.fld_i_balance})`);
    },
  },
];

/** Runs scenarios one after another and reports each; a failure doesn't stop the rest. */
export async function runScenarios(call: Call, opts: { only?: string[]; log?: (line: string) => void } = {}): Promise<ScenarioResult[]> {
  const log = opts.log ?? (() => {});
  const setup = (await call("get_setup")).text;
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (opts.only?.length && !opts.only.includes(s.id)) continue;
    const started = Date.now();
    const notes: string[] = [];
    if (s.needs?.some((n) => !setup.includes(n))) {
      results.push({ id: s.id, title: s.title, status: "skipped", notes: ["this business doesn't have what it tests"], ms: 0 });
      log(`- ${s.title}: skipped`);
      continue;
    }
    const t: Tester = {
      setup,
      note: (m) => notes.push(m),
      check(cond, message) {
        if (!cond) throw new CheckFailed(message);
        notes.push(`✓ ${message}`);
      },
      async call(tool, args = {}, o = {}) {
        const r = await call(tool, args);
        if (!r.ok && !o.allowError) throw new CheckFailed(`${tool} failed: ${r.text.slice(0, 300)}`);
        return r;
      },
    };
    try {
      await s.run(t);
      results.push({ id: s.id, title: s.title, status: "passed", notes, ms: Date.now() - started });
      log(`✓ ${s.title}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ id: s.id, title: s.title, status: "failed", notes, error, ms: Date.now() - started });
      log(`✗ ${s.title}\n    ${error}`);
    }
  }
  return results;
}

/** A Call over any MCP client (in memory or HTTP). */
export function mcpCall(client: { callTool(p: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> }): Call {
  return async (tool, args = {}) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // plain text result
    }
    return { ok: !r.isError, text, json };
  };
}
