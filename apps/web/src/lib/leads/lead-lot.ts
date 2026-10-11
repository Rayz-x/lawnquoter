/**
 * Lot size fields expected on an L01 `lead_requests` row (or linked property)
 * once that migration lands on main. Keep this adapter thin — do not invent columns.
 */
export type LeadLotSource = {
  lot_sqft?: number | string | null;
};

/** Read lot size for the rough estimate. Missing → no estimate upstream. */
export function lotSqftFromLead(lead: LeadLotSource | null | undefined): number | string | null {
  return lead?.lot_sqft ?? null;
}
