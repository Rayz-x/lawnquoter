/** Default org confidence threshold for auto site-check flagging (low band). */
export const DEFAULT_SITE_CHECK_THRESHOLD = 0.55;

export const SITE_CHECK_REASON_CODES = [
  "low_confidence",
  "no_measurement",
  "no_parcel",
  "no_footprint",
  "canopy",
  "old_imagery",
  "unknown_input",
  "manual",
  "customer_request",
] as const;

export type SiteCheckReasonCode = (typeof SITE_CHECK_REASON_CODES)[number];

const LABELS: Record<SiteCheckReasonCode, string> = {
  low_confidence: "Low measurement confidence",
  no_measurement: "Quantity entered by hand",
  no_parcel: "Parcel not matched",
  no_footprint: "No building footprint",
  canopy: "Beds under canopy",
  old_imagery: "Imagery is out of date",
  unknown_input: "Site detail unknown",
  manual: "Flagged by office",
  customer_request: "Customer requested a final price",
};

export function isSiteCheckReasonCode(value: string): value is SiteCheckReasonCode {
  return (SITE_CHECK_REASON_CODES as readonly string[]).includes(value);
}

/** Auto reasons only. Medium confidence is never auto-flagged. */
export function autoSiteCheckReasons(input: {
  confidence?: number | null;
  threshold?: number | null;
}): SiteCheckReasonCode[] {
  const threshold =
    input.threshold != null && Number.isFinite(input.threshold)
      ? Number(input.threshold)
      : DEFAULT_SITE_CHECK_THRESHOLD;
  const confidence = input.confidence;
  if (confidence == null || !Number.isFinite(confidence)) return [];
  if (confidence < threshold) return ["low_confidence"];
  return [];
}

export function hasSiteCheck(reasons: readonly string[] | null | undefined): boolean {
  return (reasons?.length ?? 0) > 0;
}

export function mergeSiteCheckReasons(
  current: readonly string[] | null | undefined,
  manual: "manual" | null,
): SiteCheckReasonCode[] {
  const next = new Set<SiteCheckReasonCode>();
  for (const reason of current ?? []) {
    if (reason === "manual") continue;
    if (isSiteCheckReasonCode(reason)) next.add(reason);
  }
  if (manual === "manual") next.add("manual");
  return [...next];
}

export function siteCheckReasonLabel(code: string): string {
  if (isSiteCheckReasonCode(code)) return LABELS[code];
  return code.replaceAll("_", " ");
}

export function siteCheckReasonsSummary(reasons: readonly string[] | null | undefined): string {
  if (!reasons?.length) return "";
  return reasons.map(siteCheckReasonLabel).join(" · ");
}

export function orgSiteCheckThreshold(settings: unknown): number {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_SITE_CHECK_THRESHOLD;
  }
  const raw = (settings as Record<string, unknown>).site_check_threshold;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 && value < 1 ? value : DEFAULT_SITE_CHECK_THRESHOLD;
}

/** Matches site_check_ensure_on_acceptance due_on = today + 5. */
export const SITE_CHECK_AFTER_ACCEPTANCE =
  "We'll confirm on site within 5 days of acceptance";

type SiteCheckRangeLine = {
  id: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  site_check_reasons: readonly string[];
};

/** Range + NTE the customer sees for selected flagged lines (sums, not max). */
export function siteCheckCustomerSees(
  lines: readonly SiteCheckRangeLine[],
  selectedIds: readonly string[],
): { low: number; high: number; notToExceed: number } | null {
  const selected = new Set(selectedIds);
  const flagged = lines.filter(
    (line) => selected.has(line.id) && hasSiteCheck(line.site_check_reasons),
  );
  if (flagged.length === 0) return null;
  const low = flagged.reduce((sum, line) => sum + (line.range_low ?? line.price), 0);
  const high = flagged.reduce((sum, line) => sum + (line.range_high ?? line.price), 0);
  return { low, high, notToExceed: high };
}

/** Customer-facing phrases for the public proposal explanation. */
const CUSTOMER_PHRASES: Record<SiteCheckReasonCode, string> = {
  low_confidence: "our aerial measurement",
  no_measurement: "the area we couldn't measure from the photo",
  no_parcel: "the property boundary",
  no_footprint: "the building footprint",
  canopy: "how much of the beds sit under trees",
  old_imagery: "details the aerial photo may have missed",
  unknown_input: "bed depth, slope, or gate width",
  manual: "a few site details",
  customer_request: "the measurements you asked us to confirm",
};

function joinEnglish(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export const SITE_CHECK_EXPLANATION_TITLE = "One price is confirmed on site";

/** Plain-language body built from reason codes (public page + PDF). */
export function siteCheckCustomerBody(reasons: readonly string[] | null | undefined): string {
  const phrases: string[] = [];
  for (const code of reasons ?? []) {
    if (!isSiteCheckReasonCode(code)) continue;
    const phrase = CUSTOMER_PHRASES[code];
    if (!phrases.includes(phrase)) phrases.push(phrase);
  }
  if (phrases.length === 0) {
    return SITE_CHECK_AFTER_ACCEPTANCE;
  }
  return `We'll check ${joinEnglish(phrases)} before we start.`;
}

export function siteCheckWhatHappensNext(notToExceedLabel: string): string[] {
  return [
    `Accept now. Your price can't go over ${notToExceedLabel}.`,
    SITE_CHECK_AFTER_ACCEPTANCE,
    "We send the final price. If it's lower, you pay less.",
  ];
}

export function youPayNoMoreThan(notToExceedLabel: string): string {
  return `You pay no more than ${notToExceedLabel}`;
}

export function acceptUpToLabel(notToExceedLabel: string): string {
  return `Accept · up to ${notToExceedLabel}`;
}

export const SITE_CHECK_LINE_PILL = "Price confirmed on site";
export const SITE_CHECK_PDF_WHY_TITLE = "Why one price is a range";

/** Shown after the customer requests a final price, before office approval. */
export const SITE_CHECK_REQUESTED_PENDING =
  "Final price requested. We'll confirm a visit date shortly.";

export const SITE_CHECK_REQUEST_CTA = "Request a final price";
export const SITE_CHECK_REQUEST_HINT =
  "Rather know first? We measure, then send a firm price to accept. Free, no commitment.";
export const SITE_CHECK_REQUEST_DECLINED = "We'll be in touch about a final price";
export const SITE_CHECK_REQUEST_CALL_US = "Call us to schedule";
export const SITE_CHECK_REQUESTED_BADGE = "Final price requested";

export function siteCheckRequestWindowCopy(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): string | null {
  if (!windowStart || !windowEnd) return null;
  const start = formatSiteCheckDate(windowStart);
  const end = formatSiteCheckDate(windowEnd);
  if (!start || !end) return null;
  return `We'll measure ${start === end ? start : `${start} – ${end}`} and send your final price. You don't need to be home.`;
}

/** Line pill after office approval sets a visit window. */
export function siteCheckMeasuringPill(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): string | null {
  if (!windowStart || !windowEnd) return null;
  const startParts = parseSiteCheckDateParts(windowStart);
  const endParts = parseSiteCheckDateParts(windowEnd);
  if (!startParts || !endParts) return null;
  const startLabel = `${startParts.month} ${startParts.day}`;
  if (startParts.iso === endParts.iso) return `Measuring ${startLabel}`;
  if (startParts.month === endParts.month) {
    return `Measuring ${startLabel}–${endParts.day}`;
  }
  return `Measuring ${startLabel}–${endParts.month} ${endParts.day}`;
}

function parseSiteCheckDateParts(
  value: string,
): { iso: string; month: string; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  return { iso: `${match[1]}-${match[2]}-${match[3]}`, month, day: Number(match[3]) };
}

function formatSiteCheckDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
