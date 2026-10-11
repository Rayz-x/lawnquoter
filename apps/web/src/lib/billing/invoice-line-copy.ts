/**
 * Customer-facing copy for an invoice line.
 * Range lines: "Estimated $300-$420 · Billed $365"
 */

function dollarsFromCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function invoiceLineCustomerCopy(input: {
  description: string;
  amountCents: number;
  estimateLowCents: number | null;
  estimateHighCents: number | null;
}): string {
  const low = input.estimateLowCents;
  const high = input.estimateHighCents;
  if (low != null && high != null) {
    return `Estimated ${dollarsFromCents(low)}-${dollarsFromCents(high)} · Billed ${dollarsFromCents(input.amountCents)}`;
  }
  return input.description;
}
