import {
  GATE_CHIP_UNDER_IN,
  GATE_CHIP_WIDE_IN,
  GATE_WIDTH_NO_GATE,
  NARROW_GATE_INCHES,
} from "@lawnquoter/pricing-engine";

export {
  GATE_CHIP_UNDER_IN,
  GATE_CHIP_WIDE_IN,
  GATE_WIDTH_NO_GATE,
  isNarrowGate,
  NARROW_GATE_INCHES,
} from "@lawnquoter/pricing-engine";

/** Office chips for narrowest gate. Deselect (ChipGroup "") means unknown — no Unknown chip. */
export const GATE_WIDTH_CHIPS = [
  { value: "under", label: "Under 48 in" },
  { value: "wide", label: "48 in+" },
  { value: "none", label: "No gate" },
] as const;

export type GateWidthChip = (typeof GATE_WIDTH_CHIPS)[number]["value"];

/** ChipGroup value: empty string means unknown (no chip selected). */
export function gateWidthChip(gateWidthIn: number | null | undefined): GateWidthChip | "" {
  if (gateWidthIn == null) return "";
  if (gateWidthIn === GATE_WIDTH_NO_GATE) return "none";
  if (gateWidthIn < NARROW_GATE_INCHES) return "under";
  return "wide";
}

/** Maps a ChipGroup value to `properties.gate_width_in`. Empty string → null (unknown). */
export function gateWidthFromChip(chip: GateWidthChip | ""): number | null {
  switch (chip) {
    case "":
      return null;
    case "under":
      return GATE_CHIP_UNDER_IN;
    case "wide":
      return GATE_CHIP_WIDE_IN;
    case "none":
      return GATE_WIDTH_NO_GATE;
  }
}

/** Crew/office label for a stored width. Null/undefined means unknown (no label). */
export function gateWidthLabel(gateWidthIn: number | null | undefined): string | null {
  if (gateWidthIn == null) return null;
  if (gateWidthIn === GATE_WIDTH_NO_GATE) return "No gate";
  return `${gateWidthIn}″ gate`;
}
