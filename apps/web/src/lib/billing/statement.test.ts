import { describe, expect, it } from "vitest";
import {
  buildAccountStatement,
  reconcileStatementClosing,
  type StatementCredit,
  type StatementInvoice,
  type StatementPayment,
} from "./statement";

describe("reconcileStatementClosing", () => {
  it("closing = opening + invoices - payments - credits", () => {
    expect(
      reconcileStatementClosing({
        openingCents: 5_000,
        invoiceCents: 12_000,
        paymentCents: 7_000,
        creditCents: 1_500,
      }),
    ).toBe(8_500);
  });
});

describe("buildAccountStatement", () => {
  it("reconciles opening, period activity, and closing for seeded ledger rows", () => {
    const from = "2026-09-01";
    const to = "2026-09-30";

    const invoices: StatementInvoice[] = [
      { id: "i-before", issuedOn: "2026-08-15", totalCents: 10_000 },
      { id: "i-period", issuedOn: "2026-09-10", totalCents: 6_000 },
      { id: "i-after", issuedOn: "2026-10-01", totalCents: 4_000 },
    ];
    const payments: StatementPayment[] = [
      { id: "p-before", receivedOn: "2026-08-20", amountCents: 3_000 },
      { id: "p-period", receivedOn: "2026-09-12", amountCents: 2_500 },
      { id: "p-after", receivedOn: "2026-10-02", amountCents: 500 },
    ];
    const credits: StatementCredit[] = [
      { id: "c-before", issuedOn: "2026-08-25", amountCents: 1_000 },
      { id: "c-period", issuedOn: "2026-09-18", amountCents: 500 },
    ];

    const statement = buildAccountStatement({
      from,
      to,
      invoices,
      payments,
      credits,
    });

    // Opening: 10000 - 3000 - 1000 = 6000
    expect(statement.openingCents).toBe(6_000);
    expect(statement.invoiceCents).toBe(6_000);
    expect(statement.paymentCents).toBe(2_500);
    expect(statement.creditCents).toBe(500);
    expect(statement.closingCents).toBe(
      reconcileStatementClosing({
        openingCents: statement.openingCents,
        invoiceCents: statement.invoiceCents,
        paymentCents: statement.paymentCents,
        creditCents: statement.creditCents,
      }),
    );
    expect(statement.closingCents).toBe(9_000);
    expect(statement.lines.map((l) => l.kind)).toEqual(["invoice", "payment", "credit"]);
  });
});
