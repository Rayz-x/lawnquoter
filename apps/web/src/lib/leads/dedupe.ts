import { normalizeAddressKey, normalizeEmail, normalizePhoneE164 } from "./normalize-contact";

/** Same person double-submit window (short). */
export const LEAD_REPEAT_FOLD_WINDOW_MS = 15 * 60 * 1000;

/** Treat as same property pin when within this distance (meters). */
export const EXACT_PROPERTY_DISTANCE_M = 25;

/** Nearby pin → possible match (meters). */
export const POSSIBLE_NEAR_DISTANCE_M = 80;

export type MatchKind = "exact_property" | "same_account" | "possible";

export type MatchProbe = {
  phone: string | null;
  email: string | null;
  addressTyped: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
};

export type MatchCandidateInput = {
  accountId: string;
  accountName: string;
  propertyId: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
  accountPhone: string | null;
  accountEmail: string | null;
  /** Distance in meters when geocode-near was used; null if unknown. */
  distanceM: number | null;
};

export type RankedMatch = {
  kind: MatchKind;
  accountId: string;
  accountName: string;
  propertyId: string | null;
  label: string;
};

export type PossibleMatchView = RankedMatch & { bannerText: string };

export type OpenLeadForFold = {
  id: string;
  phone: string | null;
  email: string | null;
  status: string;
  createdAtMs: number;
};

const KIND_RANK: Record<MatchKind, number> = {
  exact_property: 0,
  same_account: 1,
  possible: 2,
};

const FOLDABLE_STATUSES = new Set(["new", "contacted", "quoted"]);

function addressKeys(...parts: Array<string | null | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const part of parts) {
    const key = normalizeAddressKey(part);
    if (key) keys.add(key);
  }
  return keys;
}

function keysOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const key of a) {
    if (b.has(key)) return true;
  }
  for (const left of a) {
    for (const right of b) {
      if (left.length >= 8 && right.length >= 8 && (left.includes(right) || right.includes(left))) {
        return true;
      }
    }
  }
  return false;
}

function contactMatches(probe: MatchProbe, c: MatchCandidateInput): boolean {
  const phone = normalizePhoneE164(probe.phone);
  const email = normalizeEmail(probe.email);
  const cPhone = normalizePhoneE164(c.accountPhone);
  const cEmail = normalizeEmail(c.accountEmail);
  if (phone && cPhone && phone === cPhone) return true;
  if (email && cEmail && email === cEmail) return true;
  return false;
}

function classifyCandidate(probe: MatchProbe, c: MatchCandidateInput): MatchKind | null {
  const probeKeys = addressKeys(
    probe.addressTyped,
    probe.addressLine1,
    [probe.addressLine1, probe.city, probe.postalCode].filter(Boolean).join(" "),
  );
  const candidateKeys = addressKeys(
    c.formattedAddress,
    c.addressLine1,
    [c.addressLine1, c.city, c.postalCode].filter(Boolean).join(" "),
  );
  const addressHit = keysOverlap(probeKeys, candidateKeys);
  const contact = contactMatches(probe, c);
  const distance = c.distanceM;
  const hasProperty = Boolean(c.propertyId);

  const exactByPin = hasProperty && distance != null && distance <= EXACT_PROPERTY_DISTANCE_M;
  const exactByAddress = hasProperty && addressHit;

  if (exactByPin || exactByAddress) return "exact_property";
  if (contact) return "same_account";
  if (hasProperty && distance != null && distance <= POSSIBLE_NEAR_DISTANCE_M) return "possible";
  if (addressHit) return "possible";
  return null;
}

/**
 * Rank property/account candidates for a new request.
 * Exact property may auto-link; same_account / possible need office confirmation.
 * Never merges accounts.
 */
export function rankMatchCandidates(probe: MatchProbe, candidates: MatchCandidateInput[]): RankedMatch[] {
  const ranked: RankedMatch[] = [];

  for (const c of candidates) {
    const kind = classifyCandidate(probe, c);
    if (!kind) continue;
    ranked.push({
      kind,
      accountId: c.accountId,
      accountName: c.accountName,
      propertyId: c.propertyId,
      label: c.accountName,
    });
  }

  // One row per account — keep the strongest kind.
  const byAccount = new Map<string, RankedMatch>();
  for (const row of ranked) {
    const existing = byAccount.get(row.accountId);
    if (!existing || KIND_RANK[row.kind] < KIND_RANK[existing.kind]) {
      byAccount.set(row.accountId, row);
    }
  }

  return [...byAccount.values()].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.accountName.localeCompare(b.accountName),
  );
}

/** First open lead from the same person inside the fold window, else null. */
export function findRepeatFoldLead(
  probe: { phone: string | null; email: string | null },
  openLeads: OpenLeadForFold[],
  opts: { nowMs: number; windowMs?: number },
): OpenLeadForFold | null {
  const windowMs = opts.windowMs ?? LEAD_REPEAT_FOLD_WINDOW_MS;
  const since = opts.nowMs - windowMs;
  const phone = normalizePhoneE164(probe.phone);
  const email = normalizeEmail(probe.email);

  const matches = openLeads
    .filter((lead) => {
      if (!FOLDABLE_STATUSES.has(lead.status)) return false;
      if (lead.createdAtMs < since) return false;
      const leadPhone = normalizePhoneE164(lead.phone);
      const leadEmail = normalizeEmail(lead.email);
      if (phone && leadPhone && phone === leadPhone) return true;
      if (email && leadEmail && email === leadEmail) return true;
      return false;
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  return matches[0] ?? null;
}

export function pickExactPropertyLink(ranked: RankedMatch[]): RankedMatch | null {
  return ranked.find((row) => row.kind === "exact_property" && row.propertyId) ?? null;
}

/** Banner copy for office UI — never auto-merge. */
export function possibleMatchBannerText(accountName: string): string {
  return `Possible match: ${accountName}`;
}
