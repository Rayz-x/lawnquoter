import { describe, expect, it } from "vitest";
import type { AccountDirectoryEntry } from "./duplicates";
import { parseCustomerPropertyCsv, planCustomerImport } from "./csv-import";

const csv = [
  "name,phone,email,type,address_line1,city,region,postal_code",
  "Maple HOA,(615) 555-0142,hoa@example.com,commercial,100 Maple St,Springfield,IL,62704",
  "Ada Lovelace,6155550100,ada@example.com,residential,,,,",
  "Bad Row,,not-an-email,shop,100 Oak,Springfield,,",
  "",
].join("\n");

const maple: AccountDirectoryEntry = {
  accountId: "acct-maple",
  accountName: "Maple HOA",
  phones: ["+16155550142"],
  addresses: [{ addressLine1: "100 Maple Street", city: "Springfield", postalCode: "62704" }],
};

describe("parseCustomerPropertyCsv", () => {
  it("reads a customer with a property and a customer without one", () => {
    const parsed = parseCustomerPropertyCsv(csv);
    expect(parsed.rows.map((row) => row.name)).toEqual(["Maple HOA", "Ada Lovelace"]);
    expect(parsed.rows[0]).toMatchObject({
      type: "commercial",
      phone: "(615) 555-0142",
      addressLine1: "100 Maple St",
      region: "IL",
      postalCode: "62704",
    });
    expect(parsed.rows[1]?.addressLine1).toBeNull();
  });

  it("reports a bad email, an unknown type, and a partial address on that row", () => {
    const parsed = parseCustomerPropertyCsv(csv);
    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      "Enter a valid email.",
      "Type must be residential or commercial.",
      "Address needs street, city, state, and ZIP, or leave all four blank.",
    ]);
    expect(parsed.issues.every((issue) => issue.line === 4)).toBe(true);
  });

  it("rejects a file without the name column", () => {
    expect(parseCustomerPropertyCsv("phone,email\n6155550100,ada@example.com").issues[0]?.message).toBe(
      "CSV needs a name column.",
    );
  });
});

describe("planCustomerImport", () => {
  it("skips a row that matches an existing phone and address, and still plans the new customer", () => {
    const { rows } = parseCustomerPropertyCsv(csv);
    const plan = planCustomerImport(rows, [maple]);
    expect(plan.map((item) => item.kind)).toEqual(["skip", "create"]);
    expect(plan[0]).toMatchObject({ duplicate: { accountId: "acct-maple", reason: "phone_and_address" } });
    expect(plan[1]).toMatchObject({ row: { name: "Ada Lovelace" } });
  });

  it("skips a later row that repeats a customer planned earlier in the file", () => {
    const { rows } = parseCustomerPropertyCsv(
      ["name,phone", "Ada,6155550100", "Ada again,615-555-0100"].join("\n"),
    );
    const plan = planCustomerImport(rows, []);
    expect(plan.map((item) => item.kind)).toEqual(["create", "skip"]);
  });
});
