import { applyModifiers } from "./modifiers";
import { applyConfidenceRange } from "./range";
import { priceAssembly } from "./rules/assembly";
import { priceCatalog } from "./rules/catalog";
import { priceIrrigation } from "./rules/irrigation";
import { priceProgram } from "./rules/program";
import { priceSnow } from "./rules/snow";
import { priceTierMatrix } from "./rules/tier-matrix";
import { SKIPPABLE_MODIFIER_KEYS, defaultModifiers, type Modifiers, type PricedLine, type PricingRule, type PropertyContext, type QuantityMap } from "./types";

const SKIPPABLE = new Set<string>(SKIPPABLE_MODIFIER_KEYS);

function modifiersFor(rule: PricingRule, modifiers: Modifiers): Modifiers {
  const skip = rule.type === "tier_matrix" ? (rule.skipModifiers ?? []).filter((key) => SKIPPABLE.has(key)) : [];
  if (!skip.length) return modifiers;
  const next: Modifiers = { ...modifiers };
  for (const key of skip) delete next[key as keyof Modifiers];
  return next;
}

export type PriceInput = {
  rule: PricingRule;
  quantities: QuantityMap;
  context?: PropertyContext;
  modifiers?: Modifiers;
};

/** Price a single catalog rule. Always returns price, hours, and cost. */
export function priceLine(input: PriceInput): PricedLine {
  const ctx = input.context ?? {};
  let result: PricedLine;
  switch (input.rule.type) {
    case "tier_matrix":
      result = priceTierMatrix(input.rule, input.quantities);
      break;
    case "assembly":
      result = priceAssembly(input.rule, input.quantities, ctx.complexity ?? 1);
      break;
    case "catalog":
      result = priceCatalog(input.rule);
      break;
    case "program":
      result = priceProgram(input.rule);
      break;
    case "snow":
      result = priceSnow(input.rule, input.quantities);
      break;
    case "irrigation":
      result = priceIrrigation(input.rule, input.quantities);
      break;
  }
  result = applyModifiers(
    result,
    input.rule.type === "assembly" ? { ...ctx, complexity: undefined } : ctx,
    modifiersFor(input.rule, input.modifiers ?? defaultModifiers()),
  );
  return applyConfidenceRange(result, ctx.confidence);
}
