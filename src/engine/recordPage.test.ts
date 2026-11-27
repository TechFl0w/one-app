import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { memoryStore } from "./store";
import { loadBlockData } from "./blockData";
import { buildRecordQuery } from "./records";
import { defaultRecordBlocks, recordDefaults, recordPageFor, RECORD_TOKEN } from "./recordPage";

const client = "00000000-0000-4000-8000-000000000010";

describe("record pages", () => {
  it("gives every table a default page: details plus each list of linked records", () => {
    const blocks = defaultRecordBlocks(demoBlueprint, "tbl_clients");
    expect(blocks[0]).toMatchObject({ type: "details", source: { table: "tbl_clients" } });
    expect(blocks.slice(1).map((b) => [b.source?.table, b.source?.filters?.[0]])).toEqual([["tbl_bookings", { field: "fld_client", op: "eq", value: RECORD_TOKEN }]]);
    const found = recordPageFor(demoBlueprint, "tbl_clients");
    expect(found).toMatchObject({ designed: false, page: { recordOf: "tbl_clients" } });
    expect(Blueprint.safeParse({ ...demoBlueprint, pages: [...demoBlueprint.pages, found!.page] }).success).toBe(true);
  });

  it("scopes blocks to the page's record and shows its details", async () => {
    const store = memoryStore(demoRecords());
    const [details, bookings] = defaultRecordBlocks(demoBlueprint, "tbl_clients");
    const d = await loadBlockData(details, demoBlueprint, store, { recordId: client });
    expect(d).toMatchObject({ kind: "details", record: { id: client } });
    const b = await loadBlockData(bookings, demoBlueprint, store, { recordId: client });
    expect(b.kind).toBe("records");
    if (b.kind === "records") expect(b.records.length && b.records.every((r) => r.data.fld_client === client)).toBe(true);
    expect((await loadBlockData(bookings, demoBlueprint, store, {})).kind).toBe("error");
  });

  it("links records added from the page to it", () => {
    expect(recordDefaults([{ field: "fld_client", op: "eq", value: RECORD_TOKEN }, { field: "fld_status", op: "eq", value: "opt_booked" }], client)).toEqual({ fld_client: client });
  });

  it("allows one designed page per table, on a table that exists", () => {
    const page = (id: string, recordOf: string) => ({ id, label: "X", menuOrder: 9, hidden: true, recordOf, layout: { columns: 12, blocks: [] } });
    expect(Blueprint.safeParse({ ...demoBlueprint, pages: [...demoBlueprint.pages, page("pg_a", "tbl_clients"), page("pg_b", "tbl_clients")] }).error?.issues[0].message).toMatch(/already has a record page/);
    expect(Blueprint.safeParse({ ...demoBlueprint, pages: [...demoBlueprint.pages, page("pg_a", "tbl_nope")] }).success).toBe(false);
  });
});

describe("multi-links on record pages", () => {
  it("a stylist's page lists services whose 'Who does it' includes them", () => {
    const bp = {
      ...demoBlueprint,
      tables: [
        { id: "tbl_staff", label: "Stylists", primaryField: "fld_s_name", fields: [{ id: "fld_s_name", label: "Name", type: "text" }] },
        { id: "tbl_services", label: "Services", primaryField: "fld_v_name", fields: [{ id: "fld_v_name", label: "Service", type: "text" }, { id: "fld_v_who", label: "Who does it", type: "link", to: "tbl_staff", multiple: true }] },
      ],
      pages: [],
      automations: [],
      scheduling: undefined,
    } as unknown as Parameters<typeof defaultRecordBlocks>[0];
    const blocks = defaultRecordBlocks(bp, "tbl_staff");
    const services = blocks.find((b) => b.source?.table === "tbl_services")!;
    expect(services.source!.filters).toEqual([{ field: "fld_v_who", op: "contains", value: RECORD_TOKEN }]);
    expect(recordDefaults(services.source!.filters, "r1")).toEqual({ fld_v_who: ["r1"] });
    // and "eq" written by hand on a multi-link is read as "includes"
    expect(() => buildRecordQuery(bp, { table: "tbl_services", filters: [{ field: "fld_v_who", op: "eq", value: "00000000-0000-4000-8000-000000000001" }] })).not.toThrow();
  });
});
