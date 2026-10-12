import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const loadInstantQuotePage = vi.hoisted(() =>
  vi.fn(async () => ({ orgId: "org-1", orgName: "Acme", slug: "acme", services: [], consentText: "", responseTargetMinutes: 60, config: { serviceAreaZips: [], ratePerSqft: 0.01, statedMinimum: 50 } })),
);

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock("@/lib/leads/load-public-form", () => ({ loadInstantQuotePage }));

import { POST } from "./route";

const draft = {
  address: "1 Oak St",
  postalCode: "37064",
  service: "",
  hasGate: null,
  hasDogs: null,
  lotSqft: null,
  contactName: "",
  phone: "",
  email: "",
  utmSource: "facebook",
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
};

describe("POST /api/public/instant-quote/abandon", () => {
  beforeEach(() => {
    insert.mockClear();
    loadInstantQuotePage.mockClear();
  });

  it("stores an address that has no phone or email", async () => {
    const response = await POST(new Request("http://localhost/api/public/instant-quote/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "acme", draft }),
    }));
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      address: "1 Oak St",
      utm_source: "facebook",
      kind: "abandoned",
    }));
  });

  it("does not store a visit that already has an email", async () => {
    const response = await POST(new Request("http://localhost/api/public/instant-quote/abandon", {
      method: "POST",
      body: JSON.stringify({ slug: "acme", draft: { ...draft, email: "ada@example.com" } }),
    }));
    expect(response.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
  });
});
