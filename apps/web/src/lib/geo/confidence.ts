import { confidenceBand, type ConfidenceBand } from "@lawnquoter/shared";

export type ConfidenceInput = {
  parcelSource?: string | null;
  footprintSource?: string | null;
  imageryDate?: string | Date | null;
  hasManualFallback?: boolean;
};

export type ConfidenceResult = {
  score: number;
  band: ConfidenceBand;
  reasons: string[];
};

function yearsSince(date: string | Date): number | null {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** Score a measurement from imagery age, parcel match, and footprint. */
export function scoreMeasurementConfidence(input: ConfidenceInput): ConfidenceResult {
  let score = 0;
  const reasons: string[] = [];

  if (input.parcelSource === "regrid" || input.parcelSource === "county") {
    score += 0.35;
    reasons.push("Parcel boundary matched");
  } else if (input.parcelSource === "traced" || input.parcelSource === "manual") {
    score += 0.15;
    reasons.push("Parcel was traced or entered by hand");
  } else {
    reasons.push("No parcel match — lot size may be wrong");
  }

  if (input.footprintSource === "osm" || input.footprintSource === "overture") {
    score += 0.25;
    reasons.push("Building footprint found");
  } else if (input.footprintSource === "traced" || input.footprintSource === "manual") {
    score += 0.12;
    reasons.push("Building was traced by hand");
  } else {
    reasons.push("No building footprint — front/back split is estimated");
  }

  if (input.imageryDate) {
    const age = yearsSince(input.imageryDate);
    if (age !== null && age < 2) {
      score += 0.3;
      reasons.push("Imagery is less than 2 years old");
    } else if (age !== null && age < 5) {
      score += 0.15;
      reasons.push("Imagery is 2–5 years old — verify new construction");
    } else {
      reasons.push("Imagery is older than 5 years or undated — confirm on site");
    }
  } else {
    score += 0.1;
    reasons.push("Imagery date unknown");
  }

  if (input.hasManualFallback) {
    reasons.push("At least one size was entered by hand");
  }

  score = Math.min(1, Math.round(score * 1000) / 1000);
  return { score, band: confidenceBand(score), reasons };
}
