/** Flat cents plus a percent of the open balance, once the invoice is past the grace days. */
export function lateFeeCents(
  balanceCents: number,
  daysPastDue: number,
  graceDays: number,
  flatCents: number,
  feeBps: number,
): number {
  if (!Number.isInteger(balanceCents) || balanceCents <= 0) return 0;
  if (!Number.isInteger(daysPastDue) || !Number.isInteger(graceDays) || daysPastDue <= graceDays) return 0;
  if (!Number.isInteger(flatCents) || flatCents < 0) return 0;
  if (!Number.isInteger(feeBps) || feeBps < 0) return 0;
  return flatCents + Math.round((balanceCents * feeBps) / 10000);
}
