import { describe, expect, it } from "vitest";
import { isPublicAccountStatement } from "./public-statement";

describe("isPublicAccountStatement", () => {
  it("accepts a reconciled statement payload", () => {
    expect(
      isPublicAccountStatement({
        account_id: "a1",
        account_name: "Acme",
        from: "2026-09-01",
        to: "2026-09-30",
        opening_cents: 6000,
        invoice_cents: 6000,
        payment_cents: 2500,
        credit_cents: 500,
        closing_cents: 9000,
        lines: [],
        org: { name: "Stmt Co", phone: null, email: null, brand_color: null },
      }),
    ).toBe(true);
  });

  it("rejects when closing does not reconcile", () => {
    expect(
      isPublicAccountStatement({
        account_id: "a1",
        account_name: "Acme",
        from: "2026-09-01",
        to: "2026-09-30",
        opening_cents: 6000,
        invoice_cents: 6000,
        payment_cents: 2500,
        credit_cents: 500,
        closing_cents: 9999,
        lines: [],
        org: { name: "Stmt Co", phone: null, email: null, brand_color: null },
      }),
    ).toBe(false);
  });
});
