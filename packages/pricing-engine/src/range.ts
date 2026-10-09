import { confidenceBand } from "@lawnquoter/shared";
import { roundMoney } from "./money";
import type { PricedLine } from "./types";

/** Low-confidence measurements become a range instead of a binding point price. */
export function applyConfidenceRange(line: PricedLine, confidence: number | null | undefined): PricedLine {
  if (confidence == null) return line;
  const band = confidenceBand(confidence);
  if (band === "high") return { ...line, range: undefined };
  if (band === "medium") {
    return { ...line, range: { low: roundMoney(line.price * 0.95), high: roundMoney(line.price * 1.08) } };
  }
  return { ...line, range: { low: roundMoney(line.price * 0.88), high: roundMoney(line.price * 1.18) } };
}
