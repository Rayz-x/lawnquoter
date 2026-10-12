/** Equal monthly amount. The last month carries the remainder cents. */
export function levelInstallmentCents(seasonPriceCents: number, billingMonths: number, monthIndex: number): number {
  if (!Number.isInteger(seasonPriceCents) || seasonPriceCents <= 0) return 0;
  if (!Number.isInteger(billingMonths) || billingMonths < 1 || billingMonths > 24) return 0;
  if (!Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > billingMonths) return 0;
  const base = Math.trunc(seasonPriceCents / billingMonths);
  if (monthIndex === billingMonths) return seasonPriceCents - base * (billingMonths - 1);
  return base;
}
