import { describe, expect, it, vi } from "vitest";
import { QBO_NOT_CONNECTED } from "./qbo";
import { beginQboOAuth, completeQboOAuth, ensureQboAccessToken, qboOAuthStateOrg } from "./qbo-oauth";

const SECRET = "csecret";
const STATE = "org-1.9f271902824da584158b6e86042d9f6e2a2841337e6021feed9c2678736d8d29";

describe("QuickBooks OAuth", () => {
  it("stays off until both keys are set", async () => {
    expect(beginQboOAuth({ clientId: null, clientSecret: null, orgId: "org-1", redirectUri: "https://app.example/api/qbo/callback" })).toEqual({
      error: QBO_NOT_CONNECTED,
    });
    const fetchImpl = vi.fn();
    const result = await completeQboOAuth({
      code: "auth-code",
      state: STATE,
      realmId: "12345",
      clientId: null,
      clientSecret: null,
      redirectUri: "https://app.example/api/qbo/callback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      save: async () => ({ ok: true }),
    });
    expect(result).toEqual({ ok: false, error: QBO_NOT_CONNECTED });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the company to Intuit with the accounting scope", () => {
    const started = beginQboOAuth({
      clientId: "cid",
      clientSecret: SECRET,
      orgId: "org-1",
      redirectUri: "https://app.example/api/qbo/callback",
    });
    expect("url" in started).toBe(true);
    if (!("url" in started)) return;
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(qboOAuthStateOrg(STATE, SECRET)).toBe("org-1");
    expect(qboOAuthStateOrg("org-1.deadbeef", SECRET)).toBeNull();
  });

  it("stores the tokens from a successful code exchange", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }), { status: 200 }),
    );
    const save = vi.fn(async () => ({ ok: true as const }));
    const result = await completeQboOAuth({
      code: "auth-code",
      state: STATE,
      realmId: "12345",
      clientId: "cid",
      clientSecret: SECRET,
      redirectUri: "https://app.example/api/qbo/callback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      save,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Basic Y2lkOmNzZWNyZXQ=" }),
      }),
    );
    expect(save).toHaveBeenCalledWith({
      orgId: "org-1",
      realmId: "12345",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 3600,
    });
  });

  it("refreshes an expired access token and leaves a fresh one alone", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 }));
    const fresh = await ensureQboAccessToken({
      clientId: "cid",
      clientSecret: SECRET,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessExpiresAt: "2026-10-12T00:00:00.000Z",
      now: new Date("2026-10-11T00:00:00.000Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fresh).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 0, refreshed: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    const refreshed = await ensureQboAccessToken({
      clientId: "cid",
      clientSecret: SECRET,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessExpiresAt: "2026-10-01T00:00:00.000Z",
      now: new Date("2026-10-12T00:00:00.000Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(refreshed).toEqual({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 3600, refreshed: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      expect.objectContaining({ body: "grant_type=refresh_token&refresh_token=refresh-1" }),
    );
  });
});
