/** Keys that must never appear on a crew day pack (customer money / contact). */
const FORBIDDEN_KEYS = new Set([
  "price",
  "cost",
  "margin",
  "amount",
  "email",
  "billing_email",
  "billing_address_line1",
  "billing_address_line2",
  "first_name",
]);

/**
 * Walk a crew day pack. Customer `phone` is forbidden; `office.phone` is the
 * only phone the truck may receive.
 */
export function crewPackForbiddenKeys(value: unknown, path: string[] = []): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => crewPackForbiddenKeys(item, [...path, String(index)]));
  }
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = [...path, key];
    const underOffice = path[0] === "office";
    if (FORBIDDEN_KEYS.has(key) || (key === "phone" && !underOffice)) {
      hits.push(next.join("."));
    }
    hits.push(...crewPackForbiddenKeys(child, next));
  }
  return hits;
}

export function crewPackIsPrivate(value: unknown): boolean {
  return crewPackForbiddenKeys(value).length === 0;
}
