"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { getStripe } from "@/lib/stripe/client";
import { startConnectOnboarding, type ConnectRow } from "@/lib/stripe/connect";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Read via the caller's RLS session (owner/admin SELECT). */
async function connectReader() {
  const supabase = await createClient();
  return {
    async getByOrg(orgId: string) {
      const { data, error } = await supabase
        .from("org_stripe_connect")
        .select("stripe_account_id, status")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

/**
 * Writes use the service-role client after the server action has checked ownership.
 * Authenticated JWT clients have SELECT only — they cannot forge readiness or account ids.
 */
function connectWriter() {
  const admin = createAdminClient();
  return {
    async upsert(row: ConnectRow) {
      const { error } = await admin.from("org_stripe_connect").upsert(row, { onConflict: "org_id" });
      if (error) throw new Error(error.message);
    },
  };
}

export async function startStripeConnect(): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  if (session.orgRole !== "owner") return fail("Only the company owner can connect Stripe.");
  if (!process.env.STRIPE_SECRET_KEY) return fail("Stripe is not configured on the server.");
  const paymentsUrl = `${appOrigin()}/settings?tab=payments`;
  const reader = await connectReader();
  const writer = connectWriter();
  try {
    const result = await startConnectOnboarding({
      orgId: session.orgId,
      returnUrl: paymentsUrl,
      refreshUrl: paymentsUrl,
      stripe: getStripe() as Parameters<typeof startConnectOnboarding>[0]["stripe"],
      store: {
        getByOrg: (orgId) => reader.getByOrg(orgId),
        upsert: (row) => writer.upsert(row),
      },
    });
    revalidatePath("/settings");
    return { ok: true, data: { url: result.url } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not start Stripe Connect.");
  }
}

export async function openStripeDashboard(): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  if (session.orgRole !== "owner") return fail("Only the company owner can open the Stripe dashboard.");
  if (!process.env.STRIPE_SECRET_KEY) return fail("Stripe is not configured on the server.");
  const reader = await connectReader();
  try {
    const row = await reader.getByOrg(session.orgId);
    if (!row?.stripe_account_id || row.status !== "ready") {
      return fail("Stripe Connect is not ready yet.");
    }
    const link = await getStripe().accounts.createLoginLink(row.stripe_account_id);
    return { ok: true, data: { url: link.url } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not open Stripe dashboard.");
  }
}
