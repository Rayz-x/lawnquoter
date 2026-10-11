import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  possibleMatchBannerText,
  rankMatchCandidates,
  type MatchCandidateInput,
  type MatchProbe,
  type PossibleMatchView,
} from "./dedupe";
import { normalizeEmail, normalizePhoneE164 } from "./normalize-contact";

export type { PossibleMatchView };

type LooseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => LooseQuery;
      or: (filter: string) => LooseQuery;
      ilike: (column: string, value: string) => LooseQuery;
      limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    };
  };
};

type LooseQuery = {
  eq: (column: string, value: string) => LooseQuery;
  or: (filter: string) => LooseQuery;
  ilike: (column: string, value: string) => LooseQuery;
  limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
};

function asLoose(client: SupabaseClient): LooseClient {
  return client as unknown as LooseClient;
}

async function collectCandidates(
  client: LooseClient,
  orgId: string,
  probe: MatchProbe,
): Promise<MatchCandidateInput[]> {
  const phone = normalizePhoneE164(probe.phone);
  const email = normalizeEmail(probe.email);
  const out: MatchCandidateInput[] = [];
  const seen = new Set<string>();

  const push = (
    account: { id: string; name: string | null; phone: string | null; email: string | null },
    property: {
      id: string;
      address_line1: string | null;
      city: string | null;
      postal_code: string | null;
      formatted_address: string | null;
    } | null,
    distanceM: number | null,
  ) => {
    const key = `${account.id}:${property?.id ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      accountId: String(account.id),
      accountName: account.name?.trim() || "Account",
      propertyId: property?.id ? String(property.id) : null,
      addressLine1: property?.address_line1 ?? null,
      city: property?.city ?? null,
      postalCode: property?.postal_code ?? null,
      formattedAddress: property?.formatted_address ?? null,
      accountPhone: account.phone,
      accountEmail: account.email,
      distanceM,
    });
  };

  if (phone || email) {
    const filters: string[] = [];
    if (phone) filters.push(`phone.eq.${phone}`);
    if (email) filters.push(`email.ilike.${email}`);
    const { data: accounts, error } = await client
      .from("accounts")
      .select("id, name, phone, email")
      .eq("org_id", orgId)
      .or(filters.join(","))
      .limit(20);
    if (error) throw new Error(error.message);
    for (const raw of accounts ?? []) {
      const account = raw as { id: string; name: string | null; phone: string | null; email: string | null };
      const { data: props, error: propError } = await client
        .from("properties")
        .select("id, address_line1, city, postal_code, formatted_address")
        .eq("org_id", orgId)
        .eq("account_id", account.id)
        .limit(10);
      if (propError) throw new Error(propError.message);
      const list = (props ?? []) as Array<{
        id: string;
        address_line1: string | null;
        city: string | null;
        postal_code: string | null;
        formatted_address: string | null;
      }>;
      if (!list.length) push(account, null, null);
      else for (const property of list) push(account, property, null);
    }
  }

  if (probe.addressLine1) {
    const { data: props, error } = await client
      .from("properties")
      .select("id, account_id, address_line1, city, postal_code, formatted_address")
      .eq("org_id", orgId)
      .ilike("address_line1", probe.addressLine1)
      .limit(20);
    if (error) throw new Error(error.message);
    for (const raw of props ?? []) {
      const property = raw as {
        id: string;
        account_id: string;
        address_line1: string | null;
        city: string | null;
        postal_code: string | null;
        formatted_address: string | null;
      };
      const { data: account, error: accountError } = await client
        .from("accounts")
        .select("id, name, phone, email")
        .eq("id", property.account_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (accountError) throw new Error(accountError.message);
      if (!account) continue;
      const samePostal =
        !probe.postalCode ||
        !property.postal_code ||
        property.postal_code.replace(/\s+/g, "").toLowerCase() ===
          probe.postalCode.replace(/\s+/g, "").toLowerCase();
      push(
        account as { id: string; name: string | null; phone: string | null; email: string | null },
        property,
        samePostal ? 0 : null,
      );
    }
  }

  return out;
}

/** Office-side ranked matches for an unlinked lead (banner). */
export async function loadPossibleMatchesForLead(
  client: SupabaseClient,
  orgId: string,
  lead: {
    account_id?: string | null;
    phone?: string | null;
    email?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    address_line1?: string | null;
    address_typed?: string | null;
    city?: string | null;
    postal_code?: string | null;
  },
): Promise<PossibleMatchView[]> {
  if (lead.account_id) return [];

  const probe: MatchProbe = {
    phone: lead.phone ?? lead.contact_phone ?? null,
    email: lead.email ?? lead.contact_email ?? null,
    addressTyped: lead.address_typed ?? null,
    addressLine1: lead.address_line1 ?? null,
    city: lead.city ?? null,
    postalCode: lead.postal_code ?? null,
    lat: null,
    lng: null,
  };

  const candidates = await collectCandidates(asLoose(client), orgId, probe);
  return rankMatchCandidates(probe, candidates).map((row) => ({
    ...row,
    bannerText: possibleMatchBannerText(row.accountName),
  }));
}
