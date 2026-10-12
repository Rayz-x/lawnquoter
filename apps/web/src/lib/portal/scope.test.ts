import { describe, expect, it } from "vitest";
import { cardPortalRequest, customerVisibleQuote, portalExpiresAt, portalScope, serviceRequestBody, upcomingVisits } from "./scope";

describe("customer portal", () => {
  it("includes the parent account and its sites", () => {
    expect(
      portalScope("parent", [
        { id: "parent", parentAccountId: null },
        { id: "b", parentAccountId: "parent" },
        { id: "a", parentAccountId: "parent" },
        { id: "other", parentAccountId: "elsewhere" },
      ]),
    ).toEqual(["parent", "a", "b"]);
  });

  it("hides draft quotes from the customer", () => {
    expect(customerVisibleQuote("draft")).toBe(false);
    expect(customerVisibleQuote("sent")).toBe(true);
    expect(customerVisibleQuote("accepted")).toBe(true);
  });

  it("keeps a service request between 1 and 2000 characters", () => {
    expect(serviceRequestBody("  trim the hedge  ")).toBe("trim the hedge");
    expect(serviceRequestBody("   ")).toBeNull();
    expect(serviceRequestBody("x".repeat(2001))).toBeNull();
  });

  it("lists visits on or after today and drops cancelled ones", () => {
    const visits = [
      { id: "old", scheduledDate: "2026-10-01", occurrenceDate: "2026-10-01", status: "completed" },
      { id: "next", scheduledDate: null, occurrenceDate: "2026-10-12", status: "scheduled" },
      { id: "skip", scheduledDate: "2026-10-13", occurrenceDate: "2026-10-13", status: "cancelled" },
    ];
    expect(upcomingVisits(visits, "2026-10-12").map((visit) => visit.id)).toEqual(["next"]);
  });

  it("opens card update only when a customer and connected account exist", () => {
    expect(cardPortalRequest({ stripeCustomerId: null, stripeAccountId: "acct_1", returnUrl: "https://app/portal/t" })).toEqual({
      ok: false,
      message: "A card can be updated after the first payment.",
    });
    expect(cardPortalRequest({ stripeCustomerId: "cus_1", stripeAccountId: null, returnUrl: "https://app/portal/t" })).toEqual({
      ok: false,
      message: "Card updates open once payments are connected.",
    });
    expect(cardPortalRequest({ stripeCustomerId: "cus_1", stripeAccountId: "acct_1", returnUrl: "https://app/portal/t" })).toEqual({
      ok: true,
      customer: "cus_1",
      stripeAccount: "acct_1",
      returnUrl: "https://app/portal/t",
    });
  });

  it("expires a link fourteen days out", () => {
    expect(portalExpiresAt(new Date("2026-10-12T00:00:00.000Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});
