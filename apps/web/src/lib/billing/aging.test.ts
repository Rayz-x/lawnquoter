import { describe, expect, it } from "vitest";
import {
  agingBucketForDueOn,
  openInvoiceBalanceCents,
  sumAgingBuckets,
  type OpenInvoiceForAging,
} from "./aging";

describe("agingBucketForDueOn", () => {
  it("buckets by days past due relative to as-of", () => {
    const asOf = "2026-10-11";
    expect(agingBucketForDueOn("2026-10-11", asOf)).toBe("current");
    expect(agingBucketForDueOn("2026-10-12", asOf)).toBe("current");
    expect(agingBucketForDueOn("2026-10-10", asOf)).toBe("1-30");
    expect(agingBucketForDueOn("2026-09-11", asOf)).toBe("1-30");
    expect(agingBucketForDueOn("2026-09-10", asOf)).toBe("31-60");
    expect(agingBucketForDueOn("2026-08-12", asOf)).toBe("31-60");
    expect(agingBucketForDueOn("2026-08-11", asOf)).toBe("60+");
    expect(agingBucketForDueOn(null, asOf)).toBe("current");
  });
});

describe("sumAgingBuckets", () => {
  it("sums open AR into current / 1-30 / 31-60 / 60+ for seeded invoices", () => {
    const asOf = "2026-10-11";
    const seeded: OpenInvoiceForAging[] = [
      {
        id: "inv-current",
        status: "issued",
        dueOn: "2026-10-20",
        totalCents: 10_000,
        paymentCents: 0,
        creditNoteCents: 0,
      },
      {
        id: "inv-15",
        status: "issued",
        dueOn: "2026-09-26",
        totalCents: 5_000,
        paymentCents: 1_000,
        creditNoteCents: 0,
      },
      {
        id: "inv-45",
        status: "issued",
        dueOn: "2026-08-27",
        totalCents: 8_000,
        paymentCents: 0,
        creditNoteCents: 2_000,
      },
      {
        id: "inv-90",
        status: "issued",
        dueOn: "2026-07-01",
        totalCents: 12_000,
        paymentCents: 0,
        creditNoteCents: 0,
      },
      {
        id: "inv-paid",
        status: "paid",
        dueOn: "2026-07-01",
        totalCents: 3_000,
        paymentCents: 3_000,
        creditNoteCents: 0,
      },
      {
        id: "inv-void",
        status: "void",
        dueOn: "2026-07-01",
        totalCents: 9_000,
        paymentCents: 0,
        creditNoteCents: 0,
      },
      {
        id: "inv-zero",
        status: "issued",
        dueOn: "2026-07-01",
        totalCents: 2_000,
        paymentCents: 2_000,
        creditNoteCents: 0,
      },
    ];

    const buckets = sumAgingBuckets(seeded, asOf);
    expect(buckets).toEqual({
      current: 10_000,
      days1to30: 4_000,
      days31to60: 6_000,
      days60plus: 12_000,
      openAr: 32_000,
    });
    expect(buckets.current + buckets.days1to30 + buckets.days31to60 + buckets.days60plus).toBe(
      buckets.openAr,
    );
  });
});

describe("openInvoiceBalanceCents", () => {
  it("floors outstanding balance at zero", () => {
    expect(
      openInvoiceBalanceCents({ totalCents: 100, paymentCents: 40, creditNoteCents: 20 }),
    ).toBe(40);
    expect(
      openInvoiceBalanceCents({ totalCents: 100, paymentCents: 80, creditNoteCents: 40 }),
    ).toBe(0);
  });
});
