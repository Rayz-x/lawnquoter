"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { syncQboCustomers, QBO_NOT_CONNECTED, qboConfigured } from "@/lib/billing/qbo";
import { createQboCustomerClient, createQboLedgerClient, syncQboLedger } from "@/lib/billing/qbo-ledger";
import { createQboCustomerStore, createQboLedgerStore } from "@/lib/billing/qbo-ledger-store";
import { ensureQboAccessToken } from "@/lib/billing/qbo-oauth";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function resolveQboConflict(conflictId: string, choice: "kept_ours" | "kept_theirs"): Promise<ActionResult> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") return fail("Only owners and admins can resolve a QuickBooks conflict.");
  if (!qboConfigured()) return fail(QBO_NOT_CONNECTED);
  if (!z.string().uuid().safeParse(conflictId).success) return fail("Conflict not found.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_qbo_conflict", { p_id: conflictId, p_choice: choice });
  if (error) return fail(error.message);
  revalidatePath("/settings/quickbooks");
  return { ok: true };
}

export async function syncQuickBooksLedger(): Promise<ActionResult<{ pushed: number; pulled: number; conflicts: number }>> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") return fail("Only owners and admins can sync QuickBooks.");
  if (!qboConfigured()) return fail(QBO_NOT_CONNECTED);
  const clientId = process.env.QBO_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim() ?? "";
  const admin = createAdminClient();
  const [{ data: connection, error: connectionError }, { data: token, error: tokenError }] = await Promise.all([
    admin.from("qbo_connections").select("realm_id").eq("org_id", session.orgId).maybeSingle(),
    admin.from("qbo_oauth_tokens").select("access_token, refresh_token, access_expires_at").eq("org_id", session.orgId).maybeSingle(),
  ]);
  if (connectionError) return fail(connectionError.message);
  if (tokenError) return fail(tokenError.message);
  if (!connection?.realm_id || !token) return fail("Connect QuickBooks before invoices can sync.");
  const fresh = await ensureQboAccessToken({
    clientId,
    clientSecret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessExpiresAt: token.access_expires_at,
    now: new Date(),
    fetchImpl: fetch,
  });
  if ("error" in fresh) return fail(fresh.error);
  if (fresh.refreshed) {
    const { error } = await admin.from("qbo_oauth_tokens").upsert({
      org_id: session.orgId,
      access_token: fresh.accessToken,
      refresh_token: fresh.refreshToken,
      access_expires_at: new Date(Date.now() + fresh.expiresIn * 1000).toISOString(),
    });
    if (error) return fail(error.message);
  }
  try {
    const http = { realmId: connection.realm_id, accessToken: fresh.accessToken, fetchImpl: fetch };
    const customers = await syncQboCustomers(createQboCustomerStore(admin, session.orgId), createQboCustomerClient(http));
    if ("error" in customers) return fail(customers.error);
    const ledger = await syncQboLedger(createQboLedgerStore(admin, session.orgId), createQboLedgerClient(http));
    if ("error" in ledger) return fail(ledger.error);
    revalidatePath("/settings/quickbooks");
    return { ok: true, data: { pushed: ledger.pushed, pulled: ledger.pulled, conflicts: customers.conflicts + ledger.conflicts } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "QuickBooks did not sync.");
  }
}
