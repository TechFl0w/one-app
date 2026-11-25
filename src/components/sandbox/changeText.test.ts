import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
import { changeText } from "./SandboxFrame";
import type { SandboxSchema } from "@/sandbox/protocol";

const schema: SandboxSchema = {
  business: { name: "x", timezone: "UTC", currency: "EUR" },
  tables: [{ id: "tbl_rent", label: "Rent payments", fields: [{ id: "fld_amount", label: "Amount", type: "money" }, { id: "fld_note", label: "Note", type: "text" }] }],
};

describe("amount confirmation text", () => {
  it("says what changes, in the business's currency", () => {
    const t = changeText(schema, "tbl_rent", { fld_amount: 50, fld_note: "partial" });
    expect(t).toMatch(/changes an amount on a rent payment/);
    expect(t).toMatch(/Amount: €50\.00/);
    expect(t).not.toMatch(/Note/);
  });
});
