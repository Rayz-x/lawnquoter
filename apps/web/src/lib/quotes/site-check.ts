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
