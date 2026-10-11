import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createLeadSchemaClient } from "@/test/lead-schema-client";
import { markLeadLost, reopenLead } from "./lost";
import { createSupabaseLeadLostStore } from "./supabase-store";

function quotedLead() {
  return {
    id: "lead-1",
    org_id: "org-1",
    status: "quoted",
    lost_reason: null,
    lost_note: null,
    contact_name: "Pat",
    phone: "+15551234567",
    address_typed: "100 Maple St",
  };
}

describe("createSupabaseLeadLostStore against lead_requests / lead_activities", () => {
  it("marks a lead lost with reason and note, and appends summary plus meta", async () => {
    const db = createLeadSchemaClient();
    db.leadRequests.push(quotedLead());
    const store = createSupabaseLeadLostStore(db as unknown as SupabaseClient);

    const result = await markLeadLost(store, {
      leadId: "lead-1",
      orgId: "org-1",
      reason: "other",
      note: "Budget freeze",
    });

    expect(result.ok).toBe(true);
    const saved = await store.getLead("lead-1");
    expect(saved).toMatchObject({
      id: "lead-1",
      orgId: "org-1",
      status: "lost",
      lostReason: "other",
      lostNote: "Budget freeze",
    });
    expect(db.leadRequests[0]).toMatchObject({
      status: "lost",
      lost_reason: "other",
      lost_note: "Budget freeze",
    });
    expect(db.leadActivities).toEqual([
      expect.objectContaining({
        lead_request_id: "lead-1",
        org_id: "org-1",
        kind: "lead.lost",
        summary: "Marked lost: Other",
        meta: { reason: "other", note: "Budget freeze", previous_status: "quoted" },
      }),
    ]);
  });

  it("reopens a lost lead by clearing lost fields and logging the previous reason", async () => {
    const db = createLeadSchemaClient();
    db.leadRequests.push({
      ...quotedLead(),
      status: "lost",
      lost_reason: "competitor",
      lost_note: null,
    });
    const store = createSupabaseLeadLostStore(db as unknown as SupabaseClient);

    const result = await reopenLead(store, { leadId: "lead-1", orgId: "org-1" });

    expect(result.ok).toBe(true);
    const saved = await store.getLead("lead-1");
    expect(saved).toMatchObject({
      status: "contacted",
      lostReason: null,
      lostNote: null,
    });
    expect(db.leadRequests[0]).toMatchObject({
      status: "contacted",
      lost_reason: null,
      lost_note: null,
    });
    expect(db.leadActivities).toEqual([
      expect.objectContaining({
        kind: "lead.reopened",
        summary: "Reopened",
        meta: { previous_status: "lost", previous_reason: "competitor", previous_note: null },
      }),
    ]);
  });
});
