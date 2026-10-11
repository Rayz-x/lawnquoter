import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createStripePaymentWebhookStore } from "@/lib/billing/supabase-stripe-payment-store";
import { applyStripePaymentEvent } from "@/lib/billing/stripe-payment-webhook";
import { applyAccountUpdated, type ConnectStatus } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

  const paymentTypes = new Set([
    "checkout.session.completed",
    "payment_intent.succeeded",
    "payment_intent.processing",
    "payment_intent.payment_failed",
  ]);

  if (paymentTypes.has(event.type)) {
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
