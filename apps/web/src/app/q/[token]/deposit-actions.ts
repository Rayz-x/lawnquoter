"use server";

import { fail, type ActionResult } from "@/lib/actions/result";
import { DEPOSIT_NOT_CONNECTED, depositCents, depositCheckoutParams } from "@/lib/billing/deposit";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

function origin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function startDepositPayment(token: string): Promise<ActionResult<{ url: string | null }>> {
  const admin = createAdminClient();
  const { data: quote, error } = await admin
    .from("quotes")
    .select("id, org_id, deposit_amount")
    .eq("public_token", token)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!quote || depositCents(quote.deposit_amount) <= 0) return { ok: true, data: { url: null } };
  if (!process.env.STRIPE_SECRET_KEY) return fail(DEPOSIT_NOT_CONNECTED);

  const { data: connect, error: connectError } = await admin
    .from("org_stripe_connect")
    .select("stripe_account_id, status, charges_enabled")
    .eq("org_id", quote.org_id)
    .maybeSingle();
  if (connectError) return fail(connectError.message);
  if (connect?.status !== "ready" || !connect.charges_enabled || !connect.stripe_account_id) {
    return fail("Connect Stripe in Settings before a deposit can be charged.");
  }

  const { data: invoiceId, error: createError } = await admin.rpc("create_deposit_invoice", { p_quote_id: quote.id });
  if (createError) return fail(createError.message);
  if (!invoiceId) return { ok: true, data: { url: null } };

  const { data: invoice, error: invoiceError } = await admin
    .from("invoices")
    .select("id, org_id, account_id, number, number_label, status, currency, total_cents, public_token")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) return fail(invoiceError?.message ?? "Deposit invoice was not created.");
  if (invoice.status === "paid") return { ok: true, data: { url: null } };

  const base = `${origin()}/q/${token}`;
  const session = await getStripe().checkout.sessions.create(
    depositCheckoutParams({
      invoice: {
        id: invoice.id,
        orgId: invoice.org_id,
        accountId: invoice.account_id,
        number: invoice.number,
        numberLabel: invoice.number_label,
        status: invoice.status,
        currency: invoice.currency,
        totalCents: invoice.total_cents,
        publicToken: invoice.public_token,
      },
      successUrl: `${base}?deposit=paid`,
      cancelUrl: base,
    }),
    { stripeAccount: connect.stripe_account_id, idempotencyKey: `lawnquoter_deposit_${invoice.id}` },
  );
  if (!session.url) return fail("Stripe did not return a checkout link.");
  return { ok: true, data: { url: session.url } };
}
