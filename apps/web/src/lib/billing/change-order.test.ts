import { describe, expect, it } from "vitest";
import { isPublicChangeOrder } from "./change-order";

describe("isPublicChangeOrder", () => {
  it("accepts a well-formed public payload and coerces string cents", () => {
    const raw = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "sent",
      line_name: "Mow",
      prior_cap_cents: "12000",
      proposed_amount_cents: "15000",
      new_cap_cents: 15000,
      reason: "Extra beds",
      accepted_at: null,
      signer_name: null,
      account_name: "Pat",
      org: { name: "Prairie Mow", phone: null, email: null, brand_color: "#1E5235" },
    };

    expect(isPublicChangeOrder(raw)).toBe(true);
    if (isPublicChangeOrder(raw)) {
      expect(raw.prior_cap_cents).toBe(12000);
      expect(raw.proposed_amount_cents).toBe(15000);
    }
  });

  it("rejects incomplete payloads", () => {
    expect(isPublicChangeOrder({ id: "x" })).toBe(false);
    expect(isPublicChangeOrder(null)).toBe(false);
  });
});
