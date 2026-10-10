import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LeadActivity, LeadRequest } from "@/lib/leads/detail";
import { LeadDetail } from "./lead-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("./actions", () => ({
  logLeadContact: vi.fn(),
  reassignLead: vi.fn(),
  setLeadFollowUp: vi.fn(),
}));

const lead: LeadRequest = {
  id: "lead-1",
  org_id: "org-1",
  status: "new",
  contact_name: "Ada Lovelace",
  contact_email: "ada@example.com",
  contact_phone: null,
  address_line1: "1 Analytical Engine Way",
  city: "London",
  region: "ENG",
  postal_code: "SW1A",
  source: "Phone",
  assigned_to: "owner-1",
  first_contacted_at: null,
  next_follow_up_on: null,
  created_at: "2026-10-10T12:00:00.000Z",
};

const activities: LeadActivity[] = [
  {
    id: "act-1",
    org_id: "org-1",
    lead_request_id: "lead-1",
    kind: "lead.created",
    summary: "Lead created",
    meta: {},
    actor_id: null,
    occurred_at: "2026-10-10T12:00:00.000Z",
  },
];

describe("LeadDetail read_only", () => {
  it("hides action buttons for read_only view mode", () => {
    const markup = renderToStaticMarkup(
      createElement(LeadDetail, {
        lead,
        activities,
        assigneeName: "Owner One",
        people: [{ id: "owner-1", name: "Owner One" }],
        canEdit: false,
      }),
    );
    expect(markup).toContain('data-testid="lead-view-only"');
    expect(markup).not.toContain('data-testid="lead-actions"');
    expect(markup).not.toContain('data-testid="lead-log-contact"');
    expect(markup).not.toContain('data-testid="lead-reassign"');
    expect(markup).not.toContain('data-testid="lead-set-follow-up"');
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Lead created");
  });

  it("shows action buttons when canEdit", () => {
    const markup = renderToStaticMarkup(
      createElement(LeadDetail, {
        lead,
        activities,
        assigneeName: "Owner One",
        people: [{ id: "owner-1", name: "Owner One" }],
        canEdit: true,
      }),
    );
    expect(markup).toContain('data-testid="lead-actions"');
    expect(markup).toContain('data-testid="lead-log-contact"');
    expect(markup).not.toContain('data-testid="lead-view-only"');
  });
});
