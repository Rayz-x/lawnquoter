"use server";

import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { issueStripeRefund } from "@/lib/billing/issue-refund";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type UntypedFilter = {
  eq: (col: string, value: string) => UntypedFilter;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
};

type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
  };
};

/** Owner/admin asks Stripe to refund; local status waits for charge.refunded. */
export async function issuePaymentRefund(
  paymentId: string,
): Promise<ActionResult<{ stripeRefundId: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) {
    return fail("Only an owner or admin can issue a refund.");
  }
  if (!process.env.STRIPE_SECRET_KEY) return fail("Stripe is not configured on the server.");

  const supabase = (await createClient()) as unknown as UntypedClient;
  const admin = createAdminClient() as unknown as UntypedClient;

  try {
    const result = await issueStripeRefund({
      paymentId,
      store: {
        async loadPayment(id) {
          const { data, error } = await supabase
            .from("payments")
            .select("id, org_id, status, amount_cents, stripe_charge_id, stripe_payment_intent_id")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) return null;
          if (String(data.org_id) !== session.orgId) return null;
          return {
            id: String(data.id),
            orgId: String(data.org_id),
            status: String(data.status),
            amountCents: Number(data.amount_cents),
            stripeChargeId:
              data.stripe_charge_id == null ? null : String(data.stripe_charge_id),
            stripePaymentIntentId:
              data.stripe_payment_intent_id == null
                ? null
                : String(data.stripe_payment_intent_id),
          };
        },
        async loadConnectAccount(orgId) {
          const { data, error } = await admin
            .from("org_stripe_connect")
            .select("stripe_account_id, status")
            .eq("org_id", orgId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data?.stripe_account_id) return null;
          return {
            stripeAccountId: String(data.stripe_account_id),
            status: String(data.status),
          };
        },
      },
      stripe: getStripe(),
    });
    if (!result.ok) return fail(result.error);
    return { ok: true, data: { stripeRefundId: result.stripeRefundId } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not issue refund.");
  }
}
