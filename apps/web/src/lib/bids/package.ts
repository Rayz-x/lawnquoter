export const BID_FREQUENCIES = ["once", "weekly", "biweekly", "monthly", "seasonal"] as const;
export type BidFrequency = (typeof BID_FREQUENCIES)[number];

export const BID_STATUSES = ["pre_bid", "bidding", "submitted", "awarded", "lost"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const BID_STATUS_LABELS: Record<BidStatus, string> = {
  pre_bid: "Pre-bid",
  bidding: "Bidding",
  submitted: "Submitted",
  awarded: "Awarded",
  lost: "Lost",
};

const OCCURRENCES: Record<BidFrequency, number> = {
  once: 1,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  seasonal: 2,
};

export type BidLineInput = {
  unitPrice: number;
  qty: number;
  frequency: BidFrequency;
};

export function isBidFrequency(value: string): value is BidFrequency {
  return (BID_FREQUENCIES as readonly string[]).includes(value);
}

export function isBidStatus(value: string): value is BidStatus {
  return (BID_STATUSES as readonly string[]).includes(value);
}

/** Annual value of one spec line: unit price × quantity × occurrences. */
export function annualCents(line: BidLineInput): number {
  return Math.round(line.unitPrice * line.qty * OCCURRENCES[line.frequency] * 100);
}

export function packageAnnualCents(lines: BidLineInput[]): number {
  return lines.reduce((sum, line) => sum + annualCents(line), 0);
}

/** Apply one measured area to every site, or each site's own lot size. */
export function bulkMeasuredSqft(
  sites: { id: string; lotSqft: number | null }[],
  overrideSqft: number | null,
): { id: string; measuredSqft: number }[] {
  return sites.map((site) => ({
    id: site.id,
    measuredSqft: overrideSqft ?? Math.max(0, site.lotSqft ?? 0),
  }));
}
