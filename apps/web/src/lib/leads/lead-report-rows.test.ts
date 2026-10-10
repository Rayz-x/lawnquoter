import { describe, expect, it } from "vitest";
import { isMissingLeadRequestsRelation, mapLeadRequestToReportRow } from "./lead-report-rows";

describe("mapLeadRequestToReportRow", () => {
  it("maps first_contacted_at and source", () => {
    expect(
      mapLeadRequestToReportRow({
        created_at: "2026-10-01T10:00:00.000Z",
        first_contacted_at: "2026-10-01T11:00:00.000Z",
        source: "Google",
        status: "contacted",
        quote_id: null,
        account_id: null,
      }),
    ).toEqual({
      source: "Google",
      createdAt: "2026-10-01T10:00:00.000Z",
      firstContactedAt: "2026-10-01T11:00:00.000Z",
      converted: false,
    });
  });

  it("treats quoted/won and quote/account links as converted", () => {
    expect(
      mapLeadRequestToReportRow({
        created_at: "2026-10-01T10:00:00.000Z",
        first_contacted_at: null,
        source: "Referral",
        status: "quoted",
        quote_id: null,
        account_id: null,
      })?.converted,
    ).toBe(true);
    expect(
      mapLeadRequestToReportRow({
        created_at: "2026-10-01T10:00:00.000Z",
        first_contacted_at: null,
        lead_source: "Yard sign",
        status: "new",
        quote_id: "00000000-0000-4000-8000-000000000001",
        account_id: null,
      }),
    ).toMatchObject({ source: "Yard sign", converted: true });
  });

  it("drops spam", () => {
    expect(
      mapLeadRequestToReportRow({
        created_at: "2026-10-01T10:00:00.000Z",
        first_contacted_at: null,
        source: "Google",
        status: "spam",
        quote_id: null,
        account_id: null,
      }),
    ).toBeNull();
  });
});

describe("isMissingLeadRequestsRelation", () => {
  it("detects missing-table errors", () => {
    expect(isMissingLeadRequestsRelation('relation "lead_requests" does not exist')).toBe(true);
    expect(isMissingLeadRequestsRelation("Could not find the table 'public.lead_requests' in the schema cache")).toBe(
      true,
    );
    expect(isMissingLeadRequestsRelation("permission denied for table lead_requests")).toBe(false);
  });
});
