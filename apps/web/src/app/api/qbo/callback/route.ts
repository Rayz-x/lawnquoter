import { NextResponse } from "next/server";
import { completeQboOAuth } from "@/lib/billing/qbo-oauth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function origin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await completeQboOAuth({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    realmId: url.searchParams.get("realmId"),
    clientId: process.env.QBO_CLIENT_ID?.trim() || null,
    clientSecret: process.env.QBO_CLIENT_SECRET?.trim() || null,
    redirectUri: `${origin()}/api/qbo/callback`,
    fetchImpl: fetch,
    save: async (saved) => {
      const admin = createAdminClient();
      const expires = new Date(Date.now() + saved.expiresIn * 1000).toISOString();
      const { error: tokenError } = await admin.from("qbo_oauth_tokens").upsert({
        org_id: saved.orgId,
        access_token: saved.accessToken,
        refresh_token: saved.refreshToken,
        access_expires_at: expires,
      });
      if (tokenError) return { ok: false, error: tokenError.message };
      const { error: connectionError } = await admin.from("qbo_connections").upsert({
        org_id: saved.orgId,
        realm_id: saved.realmId,
        connected_at: new Date().toISOString(),
      });
      if (connectionError) return { ok: false, error: connectionError.message };
      return { ok: true };
    },
  });
  const back = `${origin()}/settings/quickbooks`;
  if (!result.ok) return NextResponse.redirect(`${back}?qbo=error`);
  return NextResponse.redirect(`${back}?qbo=connected`);
}
