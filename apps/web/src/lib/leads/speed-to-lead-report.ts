/**
 * Speed-to-lead + conversion-by-source report (L17 / #132).
 *
 * Operates on a thin lead row contract matching L01 `lead_requests` fields
 * (`created_at`, `first_contacted_at`, attribution source, conversion links).
 * Does not invent schema — loaders map available columns when L01 is on main.
 */

export type LeadReportRow = {
  /** Attribution / lead source (aligned with L02 picklist when present). */
  source: string | null;
  createdAt: string;
  firstContactedAt: string | null;
  /** True when the lead converted (quote linked or status won/quoted). */
  converted: boolean;
};

export type SourceReportRow = {
  source: string;
  leadCount: number;
  contactedCount: number;
  convertedCount: number;
  medianResponseMs: number | null;
  conversionRate: number;
};

const NONE_SOURCE = "(none)";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function responseMs(row: LeadReportRow): number | null {
  if (!row.firstContactedAt) return null;
  const created = Date.parse(row.createdAt);
  const contacted = Date.parse(row.firstContactedAt);
  if (!Number.isFinite(created) || !Number.isFinite(contacted)) return null;
  const delta = contacted - created;
  if (delta < 0) return null;
  return delta;
}

function sourceKey(source: string | null): string {
  const trimmed = source?.trim();
  return trimmed ? trimmed : NONE_SOURCE;
}

/** Aggregate median first-response time and conversion rate by source. */
export function buildSpeedToLeadReport(rows: readonly LeadReportRow[]): SourceReportRow[] {
  const bySource = new Map<
    string,
    { responses: number[]; leadCount: number; contactedCount: number; convertedCount: number }
  >();

  for (const row of rows) {
    const key = sourceKey(row.source);
    let bucket = bySource.get(key);
    if (!bucket) {
      bucket = { responses: [], leadCount: 0, contactedCount: 0, convertedCount: 0 };
      bySource.set(key, bucket);
    }
    bucket.leadCount += 1;
    const ms = responseMs(row);
    if (ms != null) {
      bucket.responses.push(ms);
      bucket.contactedCount += 1;
    }
    if (row.converted) bucket.convertedCount += 1;
  }

  return [...bySource.entries()]
    .map(([source, bucket]) => ({
      source,
      leadCount: bucket.leadCount,
      contactedCount: bucket.contactedCount,
      convertedCount: bucket.convertedCount,
      medianResponseMs: median(bucket.responses),
      conversionRate: bucket.leadCount === 0 ? 0 : bucket.convertedCount / bucket.leadCount,
    }))
    .sort((a, b) => {
      if (a.source === NONE_SOURCE) return 1;
      if (b.source === NONE_SOURCE) return -1;
      return a.source.localeCompare(b.source);
    });
}

export function formatMedianMinutes(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = ms / (60 * 1000);
  if (Number.isInteger(minutes)) return `${minutes} min`;
  return `${Number(minutes.toFixed(1))} min`;
}

export function formatConversionRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
