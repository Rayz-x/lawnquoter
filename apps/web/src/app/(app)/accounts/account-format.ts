export type IdentityDraft = {
  type: "residential" | "commercial";
  name: string;
  phone: string;
  email: string;
};

/** Empty is allowed. Anything else becomes E.164, US 10-digit numbers included. */
export function toE164(raw: string): { ok: true; phone: string | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, phone: null };
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return { ok: true, phone: `+${digits}` };
  if (digits.length === 10) return { ok: true, phone: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, phone: `+${digits}` };
  return { ok: false, error: "Enter a phone number with an area code." };
}

export function identityError(draft: IdentityDraft): string | null {
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 120) return "Name must be 2–120 characters.";
  const phone = toE164(draft.phone);
  if (!phone.ok) return phone.error;
  const email = draft.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  if (!phone.phone && !email) return "Enter a phone number or an email.";
  return null;
}

export function normalizeIdentity(draft: IdentityDraft): IdentityDraft {
  const phone = toE164(draft.phone);
  return {
    type: draft.type,
    name: draft.name.trim(),
    phone: phone.ok ? (phone.phone ?? "") : draft.phone.trim(),
    email: draft.email.trim(),
  };
}
