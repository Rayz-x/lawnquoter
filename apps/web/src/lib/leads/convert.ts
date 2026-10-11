/** Pure helpers for L10 lead → account/property/quote convert. */

export type ConvertLeadResult = {
  account_id: string;
  property_id: string;
  quote_id: string;
  measurement_path: string;
  already_converted?: boolean;
};

export function measurementPathForProperty(propertyId: string): string {
  return `/properties/${propertyId}/measure`;
}

export function parseConvertLeadResult(raw: unknown): ConvertLeadResult | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const accountId = typeof row.account_id === "string" ? row.account_id : null;
  const propertyId = typeof row.property_id === "string" ? row.property_id : null;
  const quoteId = typeof row.quote_id === "string" ? row.quote_id : null;
  if (!accountId || !propertyId || !quoteId) return null;
  const measurementPath =
    typeof row.measurement_path === "string" && row.measurement_path.length > 0
      ? row.measurement_path
      : measurementPathForProperty(propertyId);
  return {
    account_id: accountId,
    property_id: propertyId,
    quote_id: quoteId,
    measurement_path: measurementPath,
    already_converted: row.already_converted === true,
  };
}
