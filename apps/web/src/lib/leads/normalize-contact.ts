/** Shared contact/address normalization for intake + dedupe (L07). */

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase().slice(0, 320);
}

/** E.164-ish: +1 for 10-digit US, keep +digits for international. */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.slice(0, 40);
}

/** Collapse punctuation/whitespace for address equality checks. */
export function normalizeAddressKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const key = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return key || null;
}
