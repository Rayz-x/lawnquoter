/** Pure lead-intake dedupe matcher (L07). No auto-merge of accounts. */

export const EXACT_PROPERTY_RADIUS_M = 25;
export const NEAR_PROPERTY_RADIUS_M = 800;
/** Repeat submissions from the same person fold into one open request. */
export const LEAD_FOLD_WINDOW_MS = 30 * 60 * 1000;

export type MatchRank = "exact_property" | "same_account" | "possible";

export type MatchReason = "phone" | "email" | "address" | "geo";

export type MatchCandidate = {
  accountId: string;
  accountName: string;
  propertyId: string | null;
  rank: MatchRank;
  reasons: MatchReason[];
};

export type MatchQuery = {
  phone: string | null;
  email: string | null;
  addressKey: string | null;
  lat: number | null;
  lng: number | null;
};

export type MatchSourceAccount = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

export type MatchSourceProperty = {
  id: string;
  accountId: string;
  accountName: string;
  addressKey: string;
  lat: number | null;
  lng: number | null;
};

const RANK_ORDER: Record<MatchRank, number> = {
  exact_property: 0,
  same_account: 1,
  possible: 2,
};

const OPEN_FOLD_STATUSES = new Set(["new", "contacted", "quoted"]);

export function normalizeLeadPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeLeadEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeAddressKey(
  line1: string | null | undefined,
  city: string | null | undefined,
  region: string | null | undefined,
  postalCode: string | null | undefined,
): string | null {
  const parts = [line1, city, region, postalCode].map((part) =>
    (part ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
  );
  if (parts.every((part) => !part)) return null;
  if (!parts[0] || !parts[1] || !parts[2] || !parts[3]) return null;
  return parts.join("|");
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function betterRank(a: MatchRank, b: MatchRank): MatchRank {
  return RANK_ORDER[a] <= RANK_ORDER[b] ? a : b;
}

function mergeReasons(a: MatchReason[], b: MatchReason[]): MatchReason[] {
  return [...new Set([...a, ...b])];
}

export function rankMatchCandidates(
  query: MatchQuery,
  accounts: MatchSourceAccount[],
  properties: MatchSourceProperty[],
): MatchCandidate[] {
  const byAccount = new Map<string, MatchCandidate>();

  const upsert = (next: MatchCandidate) => {
    const prev = byAccount.get(next.accountId);
    if (!prev) {
      byAccount.set(next.accountId, next);
      return;
    }
    const rank = betterRank(prev.rank, next.rank);
    const preferNextProperty =
      next.rank === "exact_property" ||
      (prev.rank !== "exact_property" && next.propertyId != null && prev.propertyId == null);
    byAccount.set(next.accountId, {
      accountId: next.accountId,
      accountName: next.accountName || prev.accountName,
      propertyId: preferNextProperty ? next.propertyId : prev.propertyId,
      rank,
      reasons: mergeReasons(prev.reasons, next.reasons),
    });
  };

  for (const account of accounts) {
    const reasons: MatchReason[] = [];
    if (query.phone && account.phone && query.phone === account.phone) reasons.push("phone");
    if (query.email && account.email && query.email === account.email.toLowerCase()) {
      reasons.push("email");
    }
    if (reasons.length === 0) continue;
    upsert({
      accountId: account.id,
      accountName: account.name,
      propertyId: null,
      rank: "same_account",
      reasons,
    });
  }

  for (const property of properties) {
    const reasons: MatchReason[] = [];
    let rank: MatchRank | null = null;

    if (query.addressKey && property.addressKey && query.addressKey === property.addressKey) {
      reasons.push("address");
      rank = "exact_property";
    }

    if (
      query.lat != null &&
      query.lng != null &&
      property.lat != null &&
      property.lng != null
    ) {
      const meters = distanceMeters(query.lat, query.lng, property.lat, property.lng);
      if (meters <= EXACT_PROPERTY_RADIUS_M) {
        reasons.push("geo");
        rank = "exact_property";
      } else if (meters <= NEAR_PROPERTY_RADIUS_M) {
        reasons.push("geo");
        rank = rank ?? "possible";
      }
    }

    if (!rank) continue;
    upsert({
      accountId: property.accountId,
      accountName: property.accountName,
      propertyId: property.id,
      rank,
      reasons,
    });
  }

  return [...byAccount.values()].sort((a, b) => {
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return a.accountName.localeCompare(b.accountName);
  });
}

/** Exact property only — never auto-links same_account / possible. */
export function pickAutoLink(
  candidates: MatchCandidate[],
): { accountId: string; propertyId: string } | null {
  const exact = candidates.find((c) => c.rank === "exact_property" && c.propertyId);
  if (!exact?.propertyId) return null;
  return { accountId: exact.accountId, propertyId: exact.propertyId };
}

export type FoldIdentity = {
  phone: string | null;
  email: string | null;
};

export type FoldOpenRequest = FoldIdentity & {
  status: string;
  createdAtMs: number;
};

export function shouldFoldIntoOpenRequest(
  incoming: FoldIdentity,
  open: FoldOpenRequest,
  nowMs: number,
): boolean {
  if (!OPEN_FOLD_STATUSES.has(open.status)) return false;
  if (nowMs - open.createdAtMs > LEAD_FOLD_WINDOW_MS) return false;
  if (incoming.phone && open.phone && incoming.phone === open.phone) return true;
  if (incoming.email && open.email && incoming.email === open.email) return true;
  return false;
}

/** Candidates shown on the possible-match banner (never exact auto-linked ones). */
export function bannerCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  return candidates.filter((c) => c.rank !== "exact_property");
}
