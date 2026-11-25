import { describe, expect, it } from "vitest";
import { compileComponent } from "./compile";

const GOOD = `
import { useState } from "react";
import { Collapsible, RecordForm, useRecords, Card, Badge, optionLabel } from "@one/kit";

export default function BookingHub() {
  const [open, setOpen] = useState(true);
  const { records, loading } = useRecords({ table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }], limit: 20 });
  return (
    <div className="space-y-4">
      <Collapsible title="New booking" defaultOpen={open}>
        <RecordForm table="tbl_bookings" onSaved={() => setOpen(false)} />
      </Collapsible>
      <Card title="Upcoming">
        {loading ? "Loading…" : records.map((r) => <Badge key={r.id}>{optionLabel("tbl_bookings", "fld_status", r.data.fld_status)}</Badge>)}
      </Card>
    </div>
  );
}
`;

describe("compileComponent", () => {
  it("type-checks against the kit and emits CommonJS", () => {
    const r = compileComponent(GOOD);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.compiled).toContain('require("@one/kit")');
    expect(r.compiled).toContain('require("react/jsx-runtime")');
    expect(r.compiled).toContain("exports.default");
  });

  it("reports type errors with line numbers", () => {
    const r = compileComponent(`import { useRecords } from "@one/kit";\nexport default function X() {\n  const { records } = useRecords({ tabel: "x" });\n  return <div>{records.length}</div>;\n}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^Line 3: .*tabel/);
  });

  it("only allows react and the kit", () => {
    const r = compileComponent(`import fs from "fs";\nexport default function X() { return <div /> }`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('only "react" and "@one/kit"');
    const noDefault = compileComponent(`export function X() { return <div /> }`);
    expect(noDefault.ok).toBe(false);
  });
});
