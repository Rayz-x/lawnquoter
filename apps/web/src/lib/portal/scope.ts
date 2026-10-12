export const PORTAL_LINK_DAYS = 14;

const CUSTOMER_QUOTE_STATUSES = new Set(["sent", "viewed", "accepted", "declined", "expired", "changed"]);

export function portalExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PORTAL_LINK_DAYS * 24 * 60 * 60 * 1000);
}

export function portalScope(rootId: string, accounts: { id: string; parentAccountId: string | null }[]): string[] {
  const children = accounts
    .filter((account) => account.parentAccountId === rootId && account.id !== rootId)
    .map((account) => account.id)
    .sort();
  return [rootId, ...children];
}

export function customerVisibleQuote(status: string): boolean {
  return CUSTOMER_QUOTE_STATUSES.has(status);
}

export function serviceRequestBody(raw: string): string | null {
  const body = raw.trim();
  if (body.length < 1 || body.length > 2000) return null;
  return body;
}

export function upcomingVisits<T extends { scheduledDate: string | null; occurrenceDate: string; status: string }>(
  visits: T[],
  today: string,
): T[] {
  return visits
    .filter((visit) => visit.status !== "cancelled" && (visit.scheduledDate ?? visit.occurrenceDate) >= today)
    .slice(0, 12);
}

export type CardPortalDecision =
  | { ok: true; customer: string; stripeAccount: string; returnUrl: string }
  | { ok: false; message: string };

export function cardPortalRequest(input: {
  stripeCustomerId: string | null;
  stripeAccountId: string | null;
  returnUrl: string;
}): CardPortalDecision {
  if (!input.stripeCustomerId) return { ok: false, message: "A card can be updated after the first payment." };
  if (!input.stripeAccountId) return { ok: false, message: "Card updates open once payments are connected." };
  return { ok: true, customer: input.stripeCustomerId, stripeAccount: input.stripeAccountId, returnUrl: input.returnUrl };
}
