import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { applyStripeRefundDisputeEvent } from "@/lib/billing/stripe-refund-dispute-webhook";
import { createStripeRefundDisputeStore } from "@/lib/billing/supabase-stripe-refund-dispute-store";
import { applyAccountUpdated, type ConnectStatus } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const REFUND_DISPUTE_TYPES = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const admin = createAdminClient();

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const result = await applyAccountUpdated({
      account: {
        id: account.id,
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
      },
      store: {
        async updateByAccountId(
          accountId: string,
          patch: { charges_enabled: boolean; payouts_enabled: boolean; status: ConnectStatus },
        ) {
          const { data, error } = await admin
            .from("org_stripe_connect")
            .update(patch)
            .eq("stripe_account_id", accountId)
            .select("org_id")
            .maybeSingle();
          if (error) throw new Error(error.message);
          return Boolean(data);
        },
      },
    });
    if (!result.ok) return NextResponse.json({ received: true, ignored: true });
    return NextResponse.json({ received: true });
  }

  if (REFUND_DISPUTE_TYPES.has(event.type)) {
    const object = event.data.object as Stripe.Charge | Stripe.Dispute;
    const result = await applyStripeRefundDisputeEvent({
      event: {
        id: event.id,
        type: event.type,
        object: object as unknown as Parameters<
          typeof applyStripeRefundDisputeEvent
        >[0]["event"]["object"],
      },
      store: createStripeRefundDisputeStore(admin),
    });
    return NextResponse.json({ received: true, outcome: result.outcome });
  }

  // I07 payment events (checkout.session / payment_intent.*) compose here when that PR merges.
  return NextResponse.json({ received: true });
}
