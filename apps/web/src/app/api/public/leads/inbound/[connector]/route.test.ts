import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const loadPublicLeadForm = vi.hoisted(() =>
  vi.fn(async () => ({ orgId: "org-1", orgName: "Acme", slug: "acme", services: [], consentText: "", responseTargetMinutes: 60 })),
);

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock("@/lib/leads/load-public-form", () => ({ loadPublicLeadForm }));

import { POST } from "./route";

function call(connector: string, body: unknown, authorization?: string) {
  return POST(
    new Request(`http://localhost/api/public/leads/inbound/${connector}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ connector }) },
  );
}

describe("inbound lead webhook", () => {
  beforeEach(() => {
    insert.mockClear();
    delete process.env.THUMBTACK_WEBHOOK_SECRET;
  });

  it("stays off until the connector key is set", async () => {
    const response = await call("thumbtack", { slug: "acme", contactName: "Ada", phone: "6155550100" }, "Bearer secret");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Not connected — add THUMBTACK_WEBHOOK_SECRET to enable" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves a lead when the bearer secret matches", async () => {
    process.env.THUMBTACK_WEBHOOK_SECRET = "secret";
    const response = await call("thumbtack", { slug: "acme", contactName: "Ada", phone: "6155550100", address: "1 Oak St" }, "Bearer secret");
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      contact_name: "Ada",
      source: "Thumbtack",
      address_typed: "1 Oak St",
    }));
  });
});
