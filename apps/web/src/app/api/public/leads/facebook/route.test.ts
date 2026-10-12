import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert: vi.fn(async () => ({ error: null })) }) }),
}));
vi.mock("@/lib/leads/load-public-form", () => ({
  loadPublicLeadForm: vi.fn(async () => ({ orgId: "org-1" })),
}));

import { GET, POST } from "./route";

function signed(body: string) {
  const digest = createHmac("sha256", "app-secret").update(body).digest("hex");
  return new Request("http://localhost/api/public/leads/facebook", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${digest}` },
    body,
  });
}

describe("Facebook Lead Ads webhook", () => {
  afterEach(() => {
    delete process.env.FACEBOOK_LEAD_ADS_VERIFY_TOKEN;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  it("refuses the handshake until the verify token is set", async () => {
    const response = await GET(new Request("http://localhost/api/public/leads/facebook?hub.mode=subscribe&hub.verify_token=t&hub.challenge=abc"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Not connected — add FACEBOOK_LEAD_ADS_VERIFY_TOKEN to enable" });
  });

  it("echoes the challenge when the verify token matches", async () => {
    process.env.FACEBOOK_LEAD_ADS_VERIFY_TOKEN = "t";
    const response = await GET(new Request("http://localhost/api/public/leads/facebook?hub.mode=subscribe&hub.verify_token=t&hub.challenge=abc"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc");
  });

  it("does not call Facebook when the page token is missing", async () => {
    process.env.FACEBOOK_APP_SECRET = "app-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(signed('{"entry":[]}'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Not connected — add FACEBOOK_PAGE_ACCESS_TOKEN to enable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
