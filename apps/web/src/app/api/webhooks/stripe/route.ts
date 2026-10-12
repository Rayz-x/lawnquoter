import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { applyCardSetupEvent } from "@/lib/billing/card-on-file-webhook";
import { createCardOnFileStore } from "@/lib/billing/card-on-file-store";
import { applyStripePaymentEvent } from "@/lib/billing/stripe-payment-webhook";
import { applyStripeRefundDisputeEvent } from "@/lib/billing/stripe-refund-dispute-webhook";
import { createStripePaymentWebhookStore } from "@/lib/billing/supabase-stripe-payment-store";
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

const PAYMENT_TYPES = new Set([
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
]);

async function paymentMethodDetails(
  stripe: Stripe,
  paymentIntentId: string | null,
  stripeAccount: string | undefined,
) {
  if (!paymentIntentId) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["payment_method"] },
      stripeAccount ? { stripeAccount } : undefined,
    );
    const pm = pi.payment_method;
    if (!pm || typeof pm === "string") return null;
    if (pm.type === "card" && pm.card) {
      return { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null, type: "card" };
    }
    if (pm.type === "us_bank_account" && pm.us_bank_account) {
      return {
        brand: null,
        last4: pm.us_bank_account.last4 ?? null,
        type: "us_bank_account",
      };
    }
    return { brand: null, last4: null, type: pm.type };
  } catch {
    return null;
  }
}

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "setup") {
      const stripeAccount = typeof event.account === "string" && event.account.length > 0 ? event.account : undefined;
      const expanded =
        typeof session.setup_intent === "string"
          ? await stripe.checkout.sessions.retrieve(
              session.id,
              { expand: ["setup_intent.payment_method"] },
              stripeAccount ? { stripeAccount } : undefined,
            )
          : session;
      const outcome = await applyCardSetupEvent({
        eventId: event.id,
        session: expanded,
        store: createCardOnFileStore(admin),
      });
      return NextResponse.json({ received: true, outcome });
    }
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

  if (PAYMENT_TYPES.has(event.type)) {
    const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
    const stripeAccount =
      typeof event.account === "string" && event.account.length > 0 ? event.account : undefined;
    const result = await applyStripePaymentEvent({
      event: {
        id: event.id,
        type: event.type,
        object: object as unknown as Parameters<typeof applyStripePaymentEvent>[0]["event"]["object"],
      },
      store: createStripePaymentWebhookStore(admin),
      paymentMethodDetails: (paymentIntentId) =>
        paymentMethodDetails(stripe, paymentIntentId, stripeAccount),
    });
    return NextResponse.json({ received: true, outcome: result.outcome });
  }

  return NextResponse.json({ received: true });
}
