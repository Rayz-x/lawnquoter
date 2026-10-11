import { describe, expect, it } from "vitest";
import {
  createMemoryLeadLostStore,
  type MemoryLeadLostStore,
} from "./memory-store";
import {
  markLeadLost,
  reopenLead,
  shouldPromptLostForQuote,
  validateMarkLost,
  type LeadRecord,
} from "./lost";

function seedLead(store: MemoryLeadLostStore, overrides: Partial<LeadRecord> = {}): LeadRecord {
  const lead: LeadRecord = {
    id: "lead-1",
    orgId: "org-1",
    status: "quoted",
    lostReason: null,
    lostNote: null,
    ...overrides,
  };
  store.seed(lead);
  return lead;
}

describe("validateMarkLost", () => {
  it("rejects lost without a reason", () => {
    expect(validateMarkLost({ reason: null })).toBe("reason_required");
    expect(validateMarkLost({ reason: "" })).toBe("reason_required");
    expect(validateMarkLost({ reason: "   " })).toBe("reason_required");
  });

  it("requires a note when the reason is Other", () => {
    expect(validateMarkLost({ reason: "other" })).toBe("note_required_for_other");
    expect(validateMarkLost({ reason: "other", note: "   " })).toBe("note_required_for_other");
    expect(validateMarkLost({ reason: "other", note: "Budget freeze" })).toBeNull();
  });

  it("accepts the fixed picklist without a note", () => {
    expect(validateMarkLost({ reason: "price" })).toBeNull();
    expect(validateMarkLost({ reason: "competitor" })).toBeNull();
    expect(validateMarkLost({ reason: "no_response" })).toBeNull();
  });
});

describe("markLeadLost (store / DB seam)", () => {
  it("fails when lost without reason and writes nothing", async () => {
    const store = createMemoryLeadLostStore();
    seedLead(store);
    const result = await markLeadLost(store, { leadId: "lead-1", orgId: "org-1", reason: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/reason/i);
    expect(store.leads.get("lead-1")?.status).toBe("quoted");
    expect(store.activities).toHaveLength(0);
  });

  it("marks lost with reason and appends an activity", async () => {
    const store = createMemoryLeadLostStore();
    seedLead(store);
    const result = await markLeadLost(store, {
      leadId: "lead-1",
      orgId: "org-1",
      reason: "price",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.status).toBe("lost");
    expect(result.lead.lostReason).toBe("price");
    expect(result.activity.kind).toBe("lead.lost");
    expect(result.activity.payload).toMatchObject({ reason: "price", previous_status: "quoted" });
  });
});

describe("reopenLead (store / DB seam)", () => {
  it("restores contacted and logs activity", async () => {
    const store = createMemoryLeadLostStore();
    seedLead(store, { status: "lost", lostReason: "competitor", lostNote: null });
    const result = await reopenLead(store, { leadId: "lead-1", orgId: "org-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.status).toBe("contacted");
    expect(result.lead.lostReason).toBeNull();
    expect(result.activity.kind).toBe("lead.reopened");
    expect(store.activities.map((a) => a.kind)).toEqual(["lead.reopened"]);
  });

  it("rejects reopen when the lead is not lost", async () => {
    const store = createMemoryLeadLostStore();
    seedLead(store, { status: "contacted" });
    const result = await reopenLead(store, { leadId: "lead-1", orgId: "org-1" });
    expect(result.ok).toBe(false);
  });
});

describe("shouldPromptLostForQuote", () => {
  it("prompts for declined or expired quotes on an open lead", () => {
    expect(shouldPromptLostForQuote({ quoteStatus: "expired", leadStatus: "quoted" })).toBe(true);
    expect(shouldPromptLostForQuote({ quoteStatus: "declined", leadStatus: "contacted" })).toBe(true);
  });

  it("does not prompt when the lead is already closed or missing", () => {
    expect(shouldPromptLostForQuote({ quoteStatus: "expired", leadStatus: "lost" })).toBe(false);
    expect(shouldPromptLostForQuote({ quoteStatus: "expired", leadStatus: null })).toBe(false);
    expect(shouldPromptLostForQuote({ quoteStatus: "sent", leadStatus: "quoted" })).toBe(false);
  });
});
