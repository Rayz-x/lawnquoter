export type AgingBucket = "current" | "1-30" | "31-60" | "60+";

export type OpenInvoiceForAging = {
  id: string;
  status: string;
  dueOn: string | null;
  totalCents: number;
  paymentCents: number;
  creditNoteCents: number;
};

export type AgingBuckets = {
  current: number;
  days1to30: number;
  days31to60: number;
  days60plus: number;
  openAr: number;
};

/** Outstanding balance in integer cents (never negative). */
export function openInvoiceBalanceCents(input: {
  totalCents: number;
  paymentCents: number;
  creditNoteCents: number;
}): number {
  const total = Number.isFinite(input.totalCents) ? Math.trunc(input.totalCents) : 0;
  const payments = Number.isFinite(input.paymentCents) ? Math.trunc(input.paymentCents) : 0;
  const credits = Number.isFinite(input.creditNoteCents) ? Math.trunc(input.creditNoteCents) : 0;
  return Math.max(0, total - payments - credits);
}

function parseUtcDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Whole calendar days past due (negative / zero = current). */
export function daysPastDue(dueOn: string | null, asOf: string): number {
  if (!dueOn) return 0;
  const due = parseUtcDate(dueOn);
  const asOfDate = parseUtcDate(asOf);
  if (!due || !asOfDate) return 0;
  return Math.round((asOfDate.getTime() - due.getTime()) / 86_400_000);
}

export function agingBucketForDueOn(dueOn: string | null, asOf: string): AgingBucket {
  const days = daysPastDue(dueOn, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  return "60+";
}

/** Open AR only: issued invoices with a positive balance. */
export function sumAgingBuckets(invoices: OpenInvoiceForAging[], asOf: string): AgingBuckets {
  const buckets: AgingBuckets = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days60plus: 0,
    openAr: 0,
  };

  for (const invoice of invoices) {
    if (invoice.status !== "issued") continue;
    const balance = openInvoiceBalanceCents(invoice);
    if (balance <= 0) continue;

    const bucket = agingBucketForDueOn(invoice.dueOn, asOf);
    if (bucket === "current") buckets.current += balance;
    else if (bucket === "1-30") buckets.days1to30 += balance;
    else if (bucket === "31-60") buckets.days31to60 += balance;
    else buckets.days60plus += balance;
    buckets.openAr += balance;
  }

  return buckets;
}
