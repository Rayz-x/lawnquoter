import { NextResponse } from "next/server";
import { loadPortalAccess } from "@/lib/portal/load";
import { cardPortalRequest } from "@/lib/portal/scope";
import { getStripe } from "@/lib/stripe/client";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await loadPortalAccess(token);
  if (!access) return new NextResponse("This link has expired.", { status: 404 });
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const decision = cardPortalRequest({
    stripeCustomerId: access.stripeCustomerId,
    stripeAccountId: access.stripeAccountId,
    returnUrl: `${origin}/portal/${token}`,
  });
  if (!decision.ok) return new NextResponse(decision.message, { status: 409 });
  try {
    const session = await getStripe().billingPortal.sessions.create(
      { customer: decision.customer, return_url: decision.returnUrl },
      { stripeAccount: decision.stripeAccount },
    );
    return NextResponse.redirect(session.url);
  } catch {
    return new NextResponse("Card updates are unavailable right now.", { status: 409 });
  }
}
