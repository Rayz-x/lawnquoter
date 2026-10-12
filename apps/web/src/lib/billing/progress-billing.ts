/** This draw brings the line up to `percent` of its price, minus what is already billed. */
export function progressChargeCents(contractCents: number, billedCents: number, percent: number): number {
  if (!Number.isInteger(contractCents) || contractCents <= 0) return 0;
  if (!Number.isInteger(billedCents) || billedCents < 0) return 0;
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return 0;
  const target = Math.min(contractCents, Math.round((contractCents * percent) / 100));
  return Math.max(0, target - billedCents);
}
