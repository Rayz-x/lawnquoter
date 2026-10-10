import { describe, expect, it } from "vitest";
import {
  formatCents,
  holdReasonLabel,
  parseBillingReviewQueue,
  visitIdentityLine,
} from "./review-queue";

describe("billing review queue helpers", () => {
  it("labels hold reasons in office language", () => {
    expect(holdReasonLabel("partly_done")).toBe("Partly done");
    expect(holdReasonLabel("photo_lost")).toBe("Photo lost");
  });

  it("formats cents as USD", () => {
    expect(formatCents(4000)).toBe("$40.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("parses a queue payload and drops bad rows", () => {
    const queue = parseBillingReviewQueue({
      count: 1,
      items: [
        {
          id: "v1",
          title: "Mow",
          status: "completed",
          hold_reason: "partly_done",
          account_name: "Pat",
          address_line1: "20 Review St",
          tasks: [{ id: "t1", label: "Mow front", amount_cents: 4000, done: true }],
          upsells: [],
          completed_after_cancel: false,
        },
        { id: "bad" },
      ],
    });
    expect(queue.count).toBe(1);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.tasks[0]?.amount_cents).toBe(4000);
    expect(visitIdentityLine(queue.items[0]!)).toBe("Pat · 20 Review St");
  });
});
