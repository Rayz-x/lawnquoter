import { NextResponse } from "next/server";
import { loadCheckoutContext } from "@/lib/billing/load-checkout-invoice";
import { startInvoiceCheckout } from "@/lib/billing/stripe-checkout";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const { token } = await context.params;
  const admin = createAdminClient();
  let loaded: Awaited<ReturnType<typeof loadCheckoutContext>>;
  try {
    loaded = await loadCheckoutContext(admin, token);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load invoice." },
      { status: 500 },
    );
  }

  if (!loaded.ok) {
    const status = loaded.reason === "not_found" ? 404 : 409;
    return NextResponse.json(
      {
        error:
          loaded.reason === "not_found"
            ? "Invoice not found."
            : "Card and ACH payments are not available yet.",
      },
      { status },
    );
  }

  const origin = appOrigin(request);
  const invoiceUrl = `${origin}/i/${token}`;
  try {
    const result = await startInvoiceCheckout({
      invoice: loaded.invoice,
      stripeAccountId: loaded.stripeAccountId,
      successUrl: `${invoiceUrl}?paid=1`,
      cancelUrl: invoiceUrl,
      stripe: getStripe() as Parameters<typeof startInvoiceCheckout>[0]["stripe"],
    });
    if (!result.ok) {
      const status = result.reason === "connect_not_ready" ? 409 : 400;
      return NextResponse.json({ error: "Invoice is not payable." }, { status });
    }
    return NextResponse.json({ url: result.url, sessionId: result.sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start checkout." },
      { status: 500 },
    );
  }
}
