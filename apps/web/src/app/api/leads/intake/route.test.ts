import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  submit: vi.fn(),
}));

vi.mock("@/lib/leads/submit-request", async () => {
  const actual = await vi.importActual<typeof import("@/lib/leads/submit-request")>(
    "@/lib/leads/submit-request",
  );
  return {
    ...actual,
    submitPublicLeadRequest: harness.submit,
  };
});
vi.mock("@/lib/leads/turnstile", () => ({
  verifyTurnstileToken: vi.fn(),
}));
vi.mock("@/lib/leads/intake-geocode", () => ({
  geocodeForLeadIntake: vi.fn(),
}));
vi.mock("@/lib/leads/intake-store", () => ({
  createLeadIntakeStore: () => ({
    findOrgBySlug: vi.fn(),
    countRecentByIpHash: vi.fn(),
    countRecentByOrg: vi.fn(),
    insertLead: vi.fn(),
  }),
  createNotifyNewLead: () => vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({}),
}));

import { POST } from "./route";

beforeEach(() => {
  harness.submit.mockReset();
});

describe("POST /api/leads/intake", () => {
  it("returns generic failure for oversized bodies", async () => {
    const body = "x".repeat(40_000);
    const response = await POST(
      new Request("http://localhost/api/leads/intake", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(body.length) },
        body,
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("returns generic success without leaking spam vs new", async () => {
    harness.submit.mockResolvedValue({ ok: true, status: "spam" });
    const response = await POST(
      new Request("http://localhost/api/leads/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "acme",
          contactName: "Jane",
          addressTyped: "1 Main",
          phone: "5125551212",
          turnstileToken: "t",
          formStartedAtMs: Date.now() - 10_000,
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
