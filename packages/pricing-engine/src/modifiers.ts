import { isNarrowGate } from "./gate-width";
import { line } from "./money";
import type { Modifiers, PricedLine, PropertyContext, SeasonalFactor, TravelZone } from "./types";

const METERS_PER_MILE = 1609.344;

function known(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

/** First zone that covers the drive wins. Put the closest zone first. */
export function matchingTravelZone(
  zones: readonly TravelZone[] | undefined,
  ctx: PropertyContext,
): TravelZone | null {
  const minutes = known(ctx.driveMinutes) ? ctx.driveMinutes : null;
  const miles = known(ctx.driveMiles) ? ctx.driveMiles : null;
  if (!zones?.length || (minutes == null && miles == null)) return null;
  for (const zone of zones) {
    let saw = false;
    if (zone.maxMinutes != null) {
      if (minutes != null) {
        saw = true;
        if (minutes > zone.maxMinutes) continue;
      }
    }
    if (zone.maxMiles != null) {
      if (miles != null) {
        saw = true;
        if (miles > zone.maxMiles) continue;
      }
    }
    if ((zone.maxMinutes == null && zone.maxMiles == null) || saw) return zone;
  }
  return null;
}

export function matchingSeason(factors: readonly SeasonalFactor[] | undefined, month: number | null | undefined): SeasonalFactor | null {
  if (month == null || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return factors?.find((factor) => factor.pricePct !== 0 && factor.months.includes(month)) ?? null;
}

export function routeDensityRadiusMeters(modifiers: Modifiers): number {
  return (modifiers.routeDensity?.radiusMiles ?? 0.5) * METERS_PER_MILE;
}

/** Apply property modifiers on top of a priced line. Order matches how operators think about a lot. */
export function applyModifiers(base: PricedLine, ctx: PropertyContext, modifiers: Modifiers): PricedLine {
  let { price, hours, cost } = base;
  const breakdown = [...base.breakdown];

  const add = (label: string, dp: number, dh: number, dc = 0) => {
    if (dp === 0 && dh === 0 && dc === 0) return;
    price += dp;
    hours += dh;
    cost += dc;
    breakdown.push({ label, ...line(dp, dh, dc) });
  };

  if (ctx.complexity && ctx.complexity !== 1) {
    const factor = ctx.complexity;
    const dh = hours * (factor - 1);
    const dp = price * (factor - 1);
    const dc = cost * (factor - 1);
    hours *= factor;
    price *= factor;
    cost *= factor;
    breakdown.push({ label: `Complexity ×${factor}`, ...line(dp, dh, dc) });
  }

  if (ctx.slope && modifiers.slope?.[ctx.slope]) {
    const s = modifiers.slope[ctx.slope]!;
    // Cost follows the extra hours. pricePct stays on the price only.
    add(`Slope (${ctx.slope})`, price * s.pricePct, hours * s.hoursPct, cost * s.hoursPct);
  }

  const gateWidthIn = ctx.gateWidthIn;
  if (modifiers.narrowGate && isNarrowGate(gateWidthIn, modifiers.narrowGateInches ?? 48)) {
    add(`Narrow gate (${gateWidthIn} in)`, modifiers.narrowGate.extraPrice, modifiers.narrowGate.extraHours);
  }

  if (ctx.firstCut && modifiers.firstCut) {
    const m = modifiers.firstCut.multiplier;
    add(`First cut ×${m}`, price * (m - 1), hours * (m - 1), cost * (m - 1));
  }

  if (ctx.obstacleCount && modifiers.perObstacle) {
    add(
      `${ctx.obstacleCount} obstacles`,
      modifiers.perObstacle.extraPrice * ctx.obstacleCount,
      modifiers.perObstacle.extraHours * ctx.obstacleCount,
    );
  }

  if (ctx.hasStairs && modifiers.stairs) {
    add("Stairs", modifiers.stairs.extraPrice, modifiers.stairs.extraHours);
  }

  const zone = matchingTravelZone(modifiers.travelZones, ctx);
  if (zone) add(`Travel (${zone.label})`, zone.extraPrice, 0);

  const density = modifiers.routeDensity;
  if (density && known(ctx.nearbyStops) && ctx.nearbyStops >= density.minNearby && density.discountPct > 0) {
    add(`Route density (${ctx.nearbyStops} nearby)`, -(price * density.discountPct), 0);
  }

  const season = matchingSeason(modifiers.seasonalFactors, ctx.serviceMonth);
  if (season) {
    const points = Math.round(Math.abs(season.pricePct) * 100);
    const sign = season.pricePct > 0 ? "+" : "−";
    add(`${season.label} (${sign}${points}%)`, price * season.pricePct, 0);
  }

  const floor = Math.max(modifiers.minimum?.price ?? 0, known(ctx.serviceMinimum) ? ctx.serviceMinimum : 0);
  if (floor > 0 && price < floor) {
    const bump = floor - price;
    const hourFloor = modifiers.minimum?.hours;
    const hbump = hourFloor != null && hours < hourFloor ? hourFloor - hours : 0;
    add("Service minimum", bump, hbump);
  }

  return { ...line(price, hours, cost), breakdown };
}
