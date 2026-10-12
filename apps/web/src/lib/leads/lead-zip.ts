export function normalizeLeadZip(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = value.trim().match(/\d{5}/);
  return match?.[0] ?? null;
}

export function isOutsideLeadServiceArea(
  postalCode: string | null,
  serviceAreaZips: string[],
): boolean {
  if (serviceAreaZips.length === 0) return false;
  const zip = normalizeLeadZip(postalCode);
  if (!zip) return false;
  const allowed = new Set(
    serviceAreaZips.map((entry) => normalizeLeadZip(entry)).filter((entry): entry is string => Boolean(entry)),
  );
  if (allowed.size === 0) return false;
  return !allowed.has(zip);
}
