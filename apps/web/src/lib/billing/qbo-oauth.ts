import { createHmac, timingSafeEqual } from "node:crypto";
import { QBO_NOT_CONNECTED } from "./qbo";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export type QboTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export function qboOAuthState(orgId: string, clientSecret: string): string {
  const mac = createHmac("sha256", clientSecret).update(orgId).digest("hex");
  return `${orgId}.${mac}`;
}

export function qboOAuthStateOrg(state: string, clientSecret: string): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const orgId = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", clientSecret).update(orgId).digest();
  const actual = Buffer.from(mac, "hex");
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  return orgId;
}

export function beginQboOAuth(input: {
  clientId: string | null;
  clientSecret: string | null;
  orgId: string;
  redirectUri: string;
}): { url: string } | { error: string } {
  if (!input.clientId || !input.clientSecret) return { error: QBO_NOT_CONNECTED };
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: SCOPE,
    state: qboOAuthState(input.orgId, input.clientSecret),
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}` };
}

export async function exchangeQboAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
}): Promise<QboTokenSet | { error: string }> {
  const response = await input.fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) return { error: "QuickBooks did not connect." };
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_in !== "number") {
    return { error: "QuickBooks did not connect." };
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
}

/** Refresh when the access token is inside a minute of expiry. Does not call Intuit while the token is still fresh. */
export async function ensureQboAccessToken(input: {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshed: boolean } | { error: string }> {
  if (new Date(input.accessExpiresAt).getTime() - input.now.getTime() > 60_000) {
    return { accessToken: input.accessToken, refreshToken: input.refreshToken, expiresIn: 0, refreshed: false };
  }
  const response = await input.fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken }).toString(),
  });
  if (!response.ok) return { error: "QuickBooks did not sync." };
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_in !== "number") {
    return { error: "QuickBooks did not sync." };
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in, refreshed: true };
}

export async function completeQboOAuth(input: {
  code: string | null;
  state: string | null;
  realmId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  fetchImpl: typeof fetch;
  save: (saved: { orgId: string; realmId: string } & QboTokenSet) => Promise<{ ok: true } | { ok: false; error: string }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.clientId || !input.clientSecret) return { ok: false, error: QBO_NOT_CONNECTED };
  if (!input.code || !input.state || !input.realmId) return { ok: false, error: "QuickBooks did not connect." };
  const orgId = qboOAuthStateOrg(input.state, input.clientSecret);
  if (!orgId) return { ok: false, error: "QuickBooks did not connect." };
  const tokens = await exchangeQboAuthorizationCode({
    code: input.code,
    redirectUri: input.redirectUri,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl: input.fetchImpl,
  });
  if ("error" in tokens) return { ok: false, error: tokens.error };
  return input.save({ orgId, realmId: input.realmId, ...tokens });
}
