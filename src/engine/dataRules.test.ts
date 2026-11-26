import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import { checkDataRules } from "./dataRules";

const leases = (derive: boolean) => ({
  id: "tbl_leases", label: "Leases", fields: [
    { id: "fld_end", label: "End", type: "date" },
    { id: "fld_email", label: "Email", type: "email" },
    { id: "fld_state", label: "Status", type: "status", options: [{ id: "opt_active", label: "Active" }, { id: "opt_ended", label: "Ended" }],
      ...(derive ? { derive: { rules: [{ when: [{ field: "fld_end", op: "lt", value: "@today" }], option: "opt_ended" }], otherwise: "opt_active" } } : {}) },
  ],
});
const bp = (derive: boolean, automations: unknown[]) => Blueprint.parse({ ...demoBlueprint, tables: [...demoBlueprint.tables, leases(derive)], automations });

describe("data rules", () => {
  it("asks for statuses that describe dates to follow them", () => {
    expect(checkDataRules(bp(false, [])).join("\n")).toMatch(/Leases › Status .* follow the dates/);
    expect(checkDataRules(bp(true, []))).toEqual([]);
  });

  it("flags automations that would act on stale facts", () => {
    const late = { id: "aut_x", label: "Renewal offer", enabled: true, trigger: { type: "date_reached", table: "tbl_leases", field: "fld_end", offset: "-60d" }, conditions: [], actions: [{ type: "send_message", channel: "email" }] };
    const mover = { id: "aut_y", label: "End leases", enabled: true, trigger: { type: "date_reached", table: "tbl_leases", field: "fld_end" }, conditions: [], actions: [{ type: "update_record", values: { fld_state: "opt_ended" } }] };
    const never = { id: "aut_z", label: "On end", enabled: true, trigger: { type: "status_changed", table: "tbl_leases", field: "fld_state" }, conditions: [], actions: [{ type: "notify" }] };
    const found = checkDataRules(bp(false, [late, mover])).join("\n");
    expect(found).toMatch(/“Renewal offer” messages people on a date without checking they still qualify/);
    expect(found).toMatch(/“End leases” moves a status along/);
    expect(checkDataRules(bp(true, [never])).join("\n")).toMatch(/would never start/);
    const safe = { ...late, conditions: [{ field: "fld_state", op: "eq", value: "opt_active" }] };
    expect(checkDataRules(bp(true, [safe]))).toEqual([]);
  });
});
