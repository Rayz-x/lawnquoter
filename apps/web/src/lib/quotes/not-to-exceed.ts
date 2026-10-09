export type NotToExceedLine = {
  id: string;
  price?: number | string | null;
  range_low?: number | string | null;
  range_high?: number | string | null;
};

function amount(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

/** A line the customer saw as a range. A high without a low stays a firm price. */
export function lineHasRange(line: NotToExceedLine): boolean {
  return amount(line.range_low) != null && amount(line.range_high) != null;
}

/**
 * `acceptedTotal` is the sum of selected point prices.
 * `notToExceed` is range_high for each selected ranged line, otherwise the point price.
 */
export function acceptanceTotals(lines: NotToExceedLine[], selectedIds: Iterable<string>) {
  const picked = new Set(selectedIds);
  let pointCents = 0;
  let nteCents = 0;
  let hasRanges = false;
  for (const line of lines) {
    if (!picked.has(line.id)) continue;
    const price = amount(line.price) ?? 0;
    pointCents += cents(price);
    if (lineHasRange(line)) {
      hasRanges = true;
      nteCents += cents(amount(line.range_high) ?? price);
    } else {
      nteCents += cents(price);
    }
  }
  return {
    acceptedTotal: pointCents / 100,
    notToExceed: nteCents / 100,
    hasRanges,
  };
}
