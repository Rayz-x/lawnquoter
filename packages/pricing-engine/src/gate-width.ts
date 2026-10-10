/** Narrow-gate fee threshold in inches (push-mow). */
export const NARROW_GATE_INCHES = 48;

/** Representative width stored when the Under 48 in chip is chosen. */
export const GATE_CHIP_UNDER_IN = 36;

/** Representative width stored when the 48 in+ chip is chosen. */
export const GATE_CHIP_WIDE_IN = 48;

/** Stored value for No gate. Null means Unknown. */
export const GATE_WIDTH_NO_GATE = 0;

/** True when a measured gate is narrower than the push-mow threshold. Unknown and No gate are never narrow. */
export function isNarrowGate(
  gateWidthIn: number | null | undefined,
  thresholdInches: number = NARROW_GATE_INCHES,
): boolean {
  return gateWidthIn != null && gateWidthIn > 0 && gateWidthIn < thresholdInches;
}
