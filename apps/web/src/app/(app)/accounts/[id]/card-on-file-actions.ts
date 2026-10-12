"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { cardFromSetupSession, cardOnFileBlockedReason, startCardOnFileSetup } from "@/lib/billing/card-on-file";
import { createCardOnFileStore, upsertSavedCard } from "@/lib/billing/card-on-file-store";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function origin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function reasonMessage(reason: "not_configured" | "connect_not_ready" | "missing_url") {
  if (reason === "not_configured") return "Not connected - add a Stripe key to enable.";
  if (reason === "connect_not_ready") return "Connect Stripe in Settings before a card can be saved.";
  return "Stripe did not return a checkout link.";
}

export async function startCardOnFile(accountId: string): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return fail("Only an owner or admin can save a card.");
  const supabase = await createClient();
  const { data: account, error } = await supabase
    .from("accounts")
    .select("id, name, stripe_customer_id")
    .eq("id", accountId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!account) return fail("Account not found.");
  const { data: connect } = await supabase
    .from("org_stripe_connect")
    .select("stripe_account_id, status, charges_enabled")
    .eq("org_id", session.orgId)
    .maybeSingle();
  const connectReady = connect?.status === "ready" && Boolean(connect.charges_enabled) && Boolean(connect.stripe_account_id);
  const blocked = cardOnFileBlockedReason({ stripeKey: Boolean(process.env.STRIPE_SECRET_KEY), connectReady });
  if (blocked || !connect?.stripe_account_id) return fail(blocked ?? "Connect Stripe in Settings before a card can be saved.");
  const stripe = getStripe();
  const stripeAccount = connect!.stripe_account_id!;
  let customerId = account.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { name: account.name, metadata: { lawnquoter_account_id: accountId, lawnquoter_org_id: session.orgId } },
      { stripeAccount },
    );
    customerId = customer.id;
    const admin = createAdminClient();
    const { error: customerError } = await admin
      .from("accounts")
      .update({ stripe_customer_id: customerId })
      .eq("id", accountId)
      .eq("org_id", session.orgId);
    if (customerError) return fail(customerError.message);
  }
  const started = await startCardOnFileSetup({
    stripeKeyPresent: true,
    connectReady: true,
    stripeAccountId: stripeAccount,
    customerId,
    accountId,
    orgId: session.orgId,
    successUrl: `${origin()}/accounts/${accountId}?card_session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin()}/accounts/${accountId}`,
    createSession: async (params, stripeAccountId) => {
      const checkout = await stripe.checkout.sessions.create(params, { stripeAccount: stripeAccountId });
      return { url: checkout.url };
    },
  });
  if (!started.ok) return fail(reasonMessage(started.reason));
  return { ok: true, data: { url: started.url } };
}

export async function captureCardSetupReturn(input: {
  accountId: string;
  orgId: string;
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: "Not connected - add a Stripe key to enable." };
  const supabase = await createClient();
  const { data: connect } = await supabase
    .from("org_stripe_connect")
    .select("stripe_account_id")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (!connect?.stripe_account_id) return { ok: false, error: "Connect Stripe in Settings before a card can be saved." };
  const checkout = await getStripe().checkout.sessions.retrieve(
    input.sessionId,
    { expand: ["setup_intent.payment_method"] },
    { stripeAccount: connect.stripe_account_id },
  );
  const parsed = cardFromSetupSession(checkout as Parameters<typeof cardFromSetupSession>[0]);
  if (!parsed.ok || parsed.accountId !== input.accountId || parsed.orgId !== input.orgId) {
    return { ok: false, error: "That card setup does not match this account." };
  }
  const admin = createAdminClient();
  const store = createCardOnFileStore(admin);
  const hasCard = await store.hasCard(parsed.accountId);
  await upsertSavedCard(admin, {
    orgId: parsed.orgId,
    accountId: parsed.accountId,
    card: parsed.card,
    makeDefault: !hasCard,
  });
  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true };
}
