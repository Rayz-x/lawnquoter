/** Office-recorded methods only; Stripe stays webhook-owned. */
export const OFFICE_PAYMENT_METHODS = ["cash", "check"] as const;

export type OfficePaymentMethod = (typeof OFFICE_PAYMENT_METHODS)[number];

/** Outstanding balance in integer cents (never negative). */
export function invoiceBalanceCents(input: {
  totalCents: number;
  paymentCents: number;
  creditNoteCents: number;
}): number {
  const total = Number.isFinite(input.totalCents) ? input.totalCents : 0;
  const payments = Number.isFinite(input.paymentCents) ? input.paymentCents : 0;
  const credits = Number.isFinite(input.creditNoteCents) ? input.creditNoteCents : 0;
  return Math.max(0, Math.trunc(total) - Math.trunc(payments) - Math.trunc(credits));
}

/** How much of an available account credit applies to a draft/invoice due. */
export function accountCreditToApplyCents(availableCents: number, dueCents: number): number {
  const available = Math.max(0, Math.trunc(Number.isFinite(availableCents) ? availableCents : 0));
  const due = Math.max(0, Math.trunc(Number.isFinite(dueCents) ? dueCents : 0));
  return Math.min(available, due);
}

export function isOfficePaymentMethod(value: unknown): value is OfficePaymentMethod {
  return value === "cash" || value === "check";
}
