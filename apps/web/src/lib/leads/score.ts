export const DEFAULT_MINIMUM_LOT_SQFT = 4000;

export const LEAD_SCORE_LABEL = {
  quote_now: "Quote now",
  qualify_first: "Qualify first",
} as const;

export type LeadRecommendation = keyof typeof LEAD_SCORE_LABEL;

export type LeadScoreInput = {
  lotSqft: number | null;
  minimumLotSqft: number;
  requestedServices: readonly string[];
  offeredServices: readonly string[];
  outOfArea: boolean;
  /** Wins divided by leads for this source. Null when the source has no history. */
  sourceWinRate: number | null;
  engaged: boolean;
};

function normalize(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/**
 * Points, out of 100:
 * size 25 at or above the minimum, 5 below, 10 unknown;
 * service 25 on a match, 0 on a miss, 15 when the company has not listed services;
 * distance 20 in area, 0 out of area;
 * source 15 when the win rate is at least 0.4, 5 below that, 8 with no history;
 * engagement 15 once someone has worked the lead.
 * Out of area is always qualify first.
 */
export function scoreLead(input: LeadScoreInput): { score: number; recommendation: LeadRecommendation } {
  const size = input.lotSqft == null ? 10 : input.lotSqft >= input.minimumLotSqft ? 25 : 5;
  const offered = normalize(input.offeredServices);
  const requested = normalize(input.requestedServices);
  const service =
    offered.length === 0 ? 15 : requested.some((item) => offered.includes(item)) ? 25 : 0;
  const distance = input.outOfArea ? 0 : 20;
  const source = input.sourceWinRate == null ? 8 : input.sourceWinRate >= 0.4 ? 15 : 5;
  const engagement = input.engaged ? 15 : 0;
  const score = size + service + distance + source + engagement;
  const recommendation: LeadRecommendation =
    !input.outOfArea && score >= 70 ? "quote_now" : "qualify_first";
  return { score, recommendation };
}

export function offeredServicesFromSettings(settings: unknown): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const raw = (settings as Record<string, unknown>).lead_form_services;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

export function leadIsEngaged(status: string): boolean {
  return status === "contacted" || status === "quoted" || status === "won";
}
