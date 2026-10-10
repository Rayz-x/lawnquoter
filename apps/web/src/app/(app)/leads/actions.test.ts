import type { OrgRole } from "@lawnquoter/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Session = { userId: string; email: string | null; orgId: string; orgRole: OrgRole };

const requireOrg = vi.hoisted(() => {
  const session: Session = {
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: "owner",
  };
  return vi.fn(async (): Promise<Session> => session);
});

const createManualLeadRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/leads/queries", () => ({ createManualLeadRequest }));
vi.mock("@/lib/leads/lost", () => ({
  markLeadLost: vi.fn(),
  reopenLead: vi.fn(),
}));
vi.mock("@/lib/leads/supabase-store", () => ({
  createSupabaseLeadLostStore: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createManualLead } from "./actions";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("createManualLead", () => {
  beforeEach(() => {
    requireOrg.mockResolvedValue({
      userId: "user-1",
      email: null,
      orgId: "org-1",
      orgRole: "owner",
    } satisfies Session);
    createManualLeadRequest.mockReset();
  });

  it("blocks crew from creating leads", async () => {
    requireOrg.mockResolvedValueOnce({
      userId: "user-1",
      email: null,
      orgId: "org-1",
      orgRole: "crew",
    } satisfies Session);
    const result = await createManualLead(form({ contact_phone: "555-0100", lead_source: "Google" }));
    expect(result.ok).toBe(false);
    expect(createManualLeadRequest).not.toHaveBeenCalled();
  });

  it("stores source from the picklist and returns the new id", async () => {
    createManualLeadRequest.mockResolvedValueOnce({
      ok: true,
      lead: {
        id: "lead-1",
        org_id: "org-1",
        status: "new",
        contact_name: "Ada",
        phone: "555-0100",
        email: null,
        source: "Referral",
        source_other: null,
        assignee_id: null,
        next_follow_up_on: null,
        created_at: "2026-10-10T12:00:00.000Z",
        updated_at: "2026-10-10T12:00:00.000Z",
      },
    });

    const result = await createManualLead(
      form({
        contact_name: "Ada",
        contact_phone: "555-0100",
        lead_source: "Referral",
      }),
    );

    expect(result).toEqual({ ok: true, id: "lead-1" });
    expect(createManualLeadRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "Referral",
        source_other: null,
        phone: "555-0100",
        contact_name: "Ada",
        address_typed: "Phone lead — address not collected",
      }),
    );
  });

  it("rejects Other without detail text", async () => {
    const result = await createManualLead(
      form({ contact_phone: "555-0100", lead_source: "Other", lead_source_other: "" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Describe the lead source when Other is selected.",
    });
  });
});
