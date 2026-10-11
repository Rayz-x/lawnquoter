import { describe, expect, it } from "vitest";
import { filterPayments, type PaymentListRow } from "./payments-list";

const rows: PaymentListRow[] = [
  {
    id: "1",
    status: "succeeded",
    method: "cash",
    amountCents: 1000,
    receivedAt: "2026-10-01T12:00:00Z",
  },
  {
    id: "2",
    status: "pending",
    method: "stripe",
    amountCents: 2000,
    receivedAt: "2026-10-02T12:00:00Z",
  },
  {
    id: "3",
    status: "succeeded",
    method: "check",
    amountCents: 3000,
    receivedAt: "2026-10-03T12:00:00Z",
  },
  {
    id: "4",
    status: "failed",
    method: "stripe",
    amountCents: 4000,
    receivedAt: null,
  },
];

describe("filterPayments", () => {
  it("filters by status and method", () => {
    expect(filterPayments(rows, { status: "succeeded" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterPayments(rows, { method: "stripe" }).map((r) => r.id)).toEqual(["2", "4"]);
    expect(filterPayments(rows, { status: "succeeded", method: "cash" }).map((r) => r.id)).toEqual([
      "1",
    ]);
    expect(filterPayments(rows, {}).map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });
});
