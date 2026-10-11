import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bannerCandidates,
  normalizeAddressKey,
  normalizeLeadEmail,
  normalizeLeadPhone,
  rankMatchCandidates,
  type MatchCandidate,
  type MatchSourceAccount,
  type MatchSourceProperty,
} from "./dedupe";

export type LeadMatchRow = {
  id: string;
  org_id: string;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  account_id: string | null;
  property_id: string | null;
  geocode_raw: Record<string, unknown> | null;
};

export type LeadMatchSources = {
  accounts: MatchSourceAccount[];
  properties: MatchSourceProperty[];
};

function coordsFromUnknown(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.lat === "number" && typeof row.lng === "number") {
    return { lat: row.lat, lng: row.lng };
  }
  const coords = row.coordinates;
  if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
    return { lng: coords[0], lat: coords[1] };
  }
  return null;
}

function coordsFromGeocodeRaw(raw: Record<string, unknown> | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  if (typeof raw.lat === "number" && typeof raw.lng === "number") {
    return { lat: raw.lat, lng: raw.lng };
  }
  return null;
}

/** Shared account/property fetch for intake auto-link and lead-detail banner. */
export async function loadMatchSources(
  supabase: SupabaseClient,
  orgId: string,
  phone: string | null,
  email: string | null,
  postalCode: string | null,
): Promise<LeadMatchSources> {
  const accounts: MatchSourceAccount[] = [];
  const accountIds = new Set<string>();

  if (phone) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, name, phone, email")
      .eq("org_id", orgId)
      .eq("phone", phone)
      .limit(20);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      accountIds.add(row.id);
      accounts.push({
        id: row.id,
        name: row.name,
        phone: normalizeLeadPhone(row.phone),
        email: normalizeLeadEmail(row.email),
      });
    }
  }

  if (email) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, name, phone, email")
      .eq("org_id", orgId)
      .ilike("email", email)
      .limit(20);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (accountIds.has(row.id)) continue;
      accountIds.add(row.id);
      accounts.push({
        id: row.id,
        name: row.name,
        phone: normalizeLeadPhone(row.phone),
        email: normalizeLeadEmail(row.email),
      });
    }
  }

  let propertyQuery = supabase
    .from("properties")
    .select("id, account_id, address_line1, city, region, postal_code, location, accounts(name)")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .limit(50);

  if (postalCode) {
    propertyQuery = propertyQuery.eq("postal_code", postalCode);
  } else if (accountIds.size > 0) {
    propertyQuery = propertyQuery.in("account_id", [...accountIds]);
  } else {
    return { accounts, properties: [] };
  }

  const { data: propertyRows, error: propertyError } = await propertyQuery;
  if (propertyError) throw new Error(propertyError.message);

  const properties: MatchSourceProperty[] = [];
  for (const row of propertyRows ?? []) {
    const accountRel = row.accounts as { name?: string | null } | { name?: string | null }[] | null;
    const accountName = Array.isArray(accountRel)
      ? (accountRel[0]?.name ?? "Account")
      : (accountRel?.name ?? "Account");
    const addressKey = normalizeAddressKey(row.address_line1, row.city, row.region, row.postal_code);
    if (!addressKey) continue;
    const coords = coordsFromUnknown(row.location);
    properties.push({
      id: row.id,
      accountId: row.account_id,
      accountName,
      addressKey,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
  }

  return { accounts, properties };
}

/** Ranked non-exact candidates for the lead detail possible-match banner. */
export async function loadBannerMatchCandidates(
  supabase: SupabaseClient,
  lead: LeadMatchRow,
): Promise<MatchCandidate[]> {
  if (lead.account_id) return [];

  const phone = normalizeLeadPhone(lead.phone);
  const email = normalizeLeadEmail(lead.email);
  const addressKey = normalizeAddressKey(lead.address_line1, lead.city, lead.region, lead.postal_code);
  const point = coordsFromGeocodeRaw(lead.geocode_raw);
  const sources = await loadMatchSources(supabase, lead.org_id, phone, email, lead.postal_code);

  return bannerCandidates(
    rankMatchCandidates(
      {
        phone,
        email,
        addressKey,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
      },
      sources.accounts,
      sources.properties,
    ),
  );
}
