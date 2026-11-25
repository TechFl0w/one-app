import { describe, expect, it } from "vitest";
import { auditLine, type AuditRow } from "./auditText";
import { demoBlueprint } from "@/demo/salon";

const ME = "11111111-1111-4111-8111-111111111111";
const row = (r: Partial<AuditRow>): AuditRow => ({
  id: 1, actor_id: ME, source: "ui", action: "record.created", table_id: null, record_id: null, summary: null, details: null, created_at: "2026-11-24T10:00:00Z", ...r,
});

describe("auditLine", () => {
  it("describes record changes with labels and option names", () => {
    expect(auditLine(demoBlueprint, row({ table_id: "tbl_clients", details: { after: { fld_name: "Ava" } } }), ME)).toMatchObject({ who: "You", what: "added client “Ava”" });
    const upd = auditLine(
      demoBlueprint,
      row({ source: "ai", action: "record.updated", table_id: "tbl_bookings", details: { changes: { fld_status: { before: "opt_booked", after: "opt_done" }, fld_gone: { before: 1, after: 2 } } } }),
      ME,
    );
    expect(upd).toMatchObject({ who: "Assistant", what: "changed a booking", changes: [{ field: "Status", before: "Booked", after: "Done" }] });
    expect(auditLine(demoBlueprint, row({ actor_id: "someone", action: "record.deleted", table_id: "tbl_services", details: { before: { fld_name: "Gel" } } }), ME).what).toBe("deleted service “Gel”");
  });

  it("describes setup changes, undo and confirmations", () => {
    expect(auditLine(demoBlueprint, row({ action: "setup.changed", summary: "Rename page" }), ME).what).toBe("changed the setup: Rename page");
    expect(auditLine(demoBlueprint, row({ source: "undo", action: "setup.undone", summary: "Undo: Rename page" }), ME).what).toBe("undid a setup change (Rename page)");
    expect(auditLine(demoBlueprint, row({ source: "ai", action: "confirmation.cancelled", summary: "Delete Ava" }), ME).what).toBe("cancelled: Delete Ava");
  });
});
