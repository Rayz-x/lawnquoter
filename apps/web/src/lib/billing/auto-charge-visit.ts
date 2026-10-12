import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/client";
import { chargeIssuedVisit } from "./auto-charge";

/** Charges the default card after a visit invoice is issued. A decline does not throw. */
export async function tryAutoChargeVisitInvoice(invoiceId: string): Promise<boolean> {
  try {
    return await chargeVisitInvoice(invoiceId);
  } catch {
    return false;
  }
}

async function chargeVisitInvoice(invoiceId: string): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, source, status, total_cents, currency, org_id, account_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return false;
  const [{ data: account }, { data: method }, { data: connect }] = await Promise.all([
    admin.from("accounts").select("auto_charge, stripe_customer_id").eq("id", invoice.account_id).maybeSingle(),
    admin
      .from("account_payment_methods")
      .select("stripe_payment_method_id")
      .eq("account_id", invoice.account_id)
      .eq("org_id", invoice.org_id)
      .eq("is_default", true)
      .maybeSingle(),
    admin
      .from("org_stripe_connect")
      .select("stripe_account_id, status, charges_enabled")
      .eq("org_id", invoice.org_id)
      .maybeSingle(),
  ]);
  return chargeIssuedVisit({
    invoice: {
      id: invoice.id,
      source: invoice.source,
      status: invoice.status,
      totalCents: invoice.total_cents,
      currency: invoice.currency,
      orgId: invoice.org_id,
      accountId: invoice.account_id,
    },
    autoCharge: account?.auto_charge === true,
    stripeCustomerId: account?.stripe_customer_id ?? null,
    paymentMethodId: method?.stripe_payment_method_id ?? null,
    stripeAccountId: connect?.stripe_account_id ?? null,
    chargesEnabled: connect?.status === "ready" && Boolean(connect.charges_enabled),
    stripeKeyPresent: true,
    createPaymentIntent: (params, opts) => getStripe().paymentIntents.create(params, opts),
  });
}
