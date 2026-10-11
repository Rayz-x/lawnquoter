import { describe, expect, it, vi } from "vitest";
import { createLeadSchemaClient } from "@/test/lead-schema-client";
import { createSupabaseFollowUpDigestStore } from "./supabase-follow-up-digest-store";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

function dueLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    org_id: "org-1",
    status: "new",
    contact_name: "Pat",
    phone: "+15551234567",
    address_typed: "100 Maple St",
    assignee_id: "user-a",
    next_follow_up_on: "2026-10-10",
    lost_reason: null,
    lost_note: null,
    ...overrides,
  };
}

describe("createSupabaseFollowUpDigestStore listFollowUpLeads", () => {
  it("returns leads using real lead_requests columns", async () => {
    const db = createLeadSchemaClient();
    db.leadRequests.push(dueLead(), dueLead({ id: "lead-2", org_id: "org-2", contact_name: "Other" }));
    db.profiles.set("user-a", { email: "a@example.com" });
    const store = createSupabaseFollowUpDigestStore(db as never);

    const leads = await store.listFollowUpLeads("org-1");

    expect(leads).toEqual([
      {
        id: "lead-1",
        orgId: "org-1",
        assigneeId: "user-a",
        assigneeEmail: "a@example.com",
        nextFollowUpOn: "2026-10-10",
        lastActivityAt: null,
        status: "new",
        contactName: "Pat",
      },
    ]);
  });

  it("returns [] when lead_requests is missing (42P01)", async () => {
    const missing = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: null,
            error: { code: "42P01", message: 'relation "lead_requests" does not exist' },
          }),
        }),
      }),
    };
    const store = createSupabaseFollowUpDigestStore(missing as never);

    await expect(store.listFollowUpLeads("org-1")).resolves.toEqual([]);
  });

  it("throws when the error is a missing column rather than a missing relation", async () => {
    const missingColumn = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: null,
            error: {
              code: "42703",
              message: 'column "last_activity_at" of relation "lead_requests" does not exist',
            },
          }),
        }),
      }),
    };
    const store = createSupabaseFollowUpDigestStore(missingColumn as never);

    await expect(store.listFollowUpLeads("org-1")).rejects.toThrow(
      'column "last_activity_at" of relation "lead_requests" does not exist',
    );
  });
});
