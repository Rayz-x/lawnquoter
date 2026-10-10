import { isNarrowGate } from "./gate-width";
import { line } from "./money";
import type { Modifiers, PricedLine, PropertyContext } from "./types";

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

  if (modifiers.minimum && price < modifiers.minimum.price) {
    const bump = modifiers.minimum.price - price;
    const hbump = modifiers.minimum.hours != null && hours < modifiers.minimum.hours ? modifiers.minimum.hours - hours : 0;
    add("Service minimum", bump, hbump);
  }

  return { ...line(price, hours, cost), breakdown };
}
