const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const withoutCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** en-US currency. Whole-dollar line amounts omit cents; pass `cents` for totals. */
export function formatMoney(amount: number, options?: { cents?: boolean }) {
  const value = Number.isFinite(amount) ? amount : 0;
  const cents = options?.cents ?? Math.round(value * 100) % 100 !== 0;
  return (cents ? withCents : withoutCents).format(value);
}

/** Spaced en dash, matching the brand range style. */
export function formatMoneyRange(low: number, high: number) {
  return `${formatMoney(low)} – ${formatMoney(high)}`;
}
