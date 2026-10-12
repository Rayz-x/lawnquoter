import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/session";
import { beginQboOAuth } from "@/lib/billing/qbo-oauth";

export const runtime = "nodejs";

function origin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function GET() {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") {
    return NextResponse.json({ error: "You cannot connect QuickBooks." }, { status: 403 });
  }
  const started = beginQboOAuth({
    clientId: process.env.QBO_CLIENT_ID?.trim() || null,
    clientSecret: process.env.QBO_CLIENT_SECRET?.trim() || null,
    orgId: session.orgId,
    redirectUri: `${origin()}/api/qbo/callback`,
  });
  if ("error" in started) return NextResponse.json({ error: started.error }, { status: 503 });
  return NextResponse.redirect(started.url);
}
