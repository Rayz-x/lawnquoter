import { describe, expect, it } from "vitest";
import { exportJson, exportPdfLines, invoicePdfLines, storedZip, tableCsv, type ExportTables } from "./bundle";

const tables: ExportTables = {
  accounts: [{ id: "a", name: "North" }],
  properties: [],
  quotes: [{ id: "q", account_id: "a", number: 12, title: "Spring", status: "accepted" }],
  invoices: [{ id: "i", total_cents: 1500 }],
};

describe("company export", () => {
  it("quotes commas and quotes in CSV cells", () => {
    expect(tableCsv(["name", "qty"], [{ name: 'Oak, "North"', qty: 2 }])).toBe('name,qty\n"Oak, ""North""",2\n');
  });

  it("writes the same records as JSON and a PDF register", () => {
    expect(exportJson(tables)).toContain('"name": "North"');
    expect(exportPdfLines(tables)).toEqual([
      "LawnQuoter export",
      "Accounts: 1",
      "Properties: 0",
      "Quotes: 1",
      "Invoices: 1",
      "Q-12 Spring — accepted",
    ]);
  });

  it("writes an invoice PDF separate from the register", () => {
    expect(
      invoicePdfLines({
        ...tables,
        invoices: [{ id: "i", number_label: "INV-3", status: "issued", total_cents: 1500 }],
      }),
    ).toEqual(["LawnQuoter invoices", "INV-3 — issued — 1500 cents"]);
  });

  it("stores a zip member named accounts.csv", () => {
    const zip = storedZip([{ name: "accounts.csv", bytes: new TextEncoder().encode("id\n") }]);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(zip.subarray(30, 30 + "accounts.csv".length))).toBe("accounts.csv");
  });
});
