import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadIntakeDeps, LeadIntakeInsert, LeadIntakeOrg } from "./submit-request";

type UntypedFrom = {
  select: (columns: string, opts?: { count?: "exact"; head?: boolean }) => UntypedFilter;
  insert: (values: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    };
  };
};

type UntypedFilter = {
  eq: (column: string, value: string) => UntypedFilter;
  gte: (column: string, value: string) => UntypedFilter;
  filter: (column: string, op: string, value: string) => UntypedFilter;
  limit: (n: number) => UntypedFilter;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then: (
    onfulfilled?: (value: { count: number | null; error: { message: string } | null }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

type UntypedClient = {
  from: (table: string) => UntypedFrom;
};

function asUntyped(client: SupabaseClient): UntypedClient {
  return client as unknown as UntypedClient;
}

function settingsText(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== "object") return null;
  const value = (settings as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function resolveDefaultAssignee(
  client: UntypedClient,
  orgId: string,
  settings: unknown,
): Promise<string | null> {
  const configured = settingsText(settings, "lead_default_assignee");
  if (configured && configured !== "owner" && /^[0-9a-f-]{36}$/i.test(configured)) {
    const { data } = await client
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", configured)
      .eq("status", "active")
      .maybeSingle();
    if (data?.user_id) return String(data.user_id);
  }

  const { data: owner } = await client
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return owner?.user_id ? String(owner.user_id) : null;
}

export function createLeadIntakeStore(
  admin: SupabaseClient,
): Pick<
  LeadIntakeDeps,
  "findOrgBySlug" | "countRecentByIpHash" | "countRecentByOrg" | "insertLead"
> {
  const db = asUntyped(admin);

  return {
    async findOrgBySlug(slug: string): Promise<LeadIntakeOrg | null> {
      const { data, error } = await db
        .from("orgs")
        .select("id, settings")
        .filter("settings->>lead_form_slug", "eq", slug)
        .maybeSingle();
      if (error || !data) return null;
      const orgId = String(data.id);
      const consentTextVersion = settingsText(data.settings, "lead_consent_text_version") ?? "v1";
      const defaultAssigneeId = await resolveDefaultAssignee(db, orgId, data.settings);
      return { orgId, consentTextVersion, defaultAssigneeId };
    },

    async countRecentByIpHash(orgId, ipHash, sinceIso) {
      const result = (await db
        .from("lead_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso)) as { count: number | null; error: { message: string } | null };
      if (result.error) throw new Error(result.error.message);
      return result.count ?? 0;
    },

    async countRecentByOrg(orgId, sinceIso) {
      const result = (await db
        .from("lead_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", sinceIso)) as { count: number | null; error: { message: string } | null };
      if (result.error) throw new Error(result.error.message);
      return result.count ?? 0;
    },

    async insertLead(row: LeadIntakeInsert) {
      const payload: Record<string, unknown> = {
        org_id: row.orgId,
        status: row.status,
        contact_name: row.contactName,
        phone: row.phone,
        email: row.email,
        preferred_contact: row.preferredContact,
        is_business: row.isBusiness,
        address_typed: row.addressTyped,
        address_line1: row.addressLine1,
        city: row.city,
        region: row.region,
        postal_code: row.postalCode,
        country: row.country,
        geocode_score: row.geocodeScore,
        geocode_attribution: row.geocodeAttribution,
        geocode_raw: row.geocodeRaw,
        services: row.services,
        note: row.note,
        source: row.source,
        source_other: row.sourceOther,
        utm_source: row.utmSource,
        utm_medium: row.utmMedium,
        utm_campaign: row.utmCampaign,
        utm_term: row.utmTerm,
        utm_content: row.utmContent,
        referrer: row.referrer,
        landing_page: row.landingPage,
        sms_consent: row.smsConsent,
        consent_text_version: row.consentTextVersion,
        consent_at: row.consentAt,
        consent_ip_hash: row.consentIpHash,
        consent_ua: row.consentUa,
        spam_score: row.spamScore,
        ip_hash: row.ipHash,
        assignee_id: row.assigneeId,
      };
      // location geography left null; coordinates stay in geocode_raw for L06 pin write.

      const { data, error } = await db.from("lead_requests").insert(payload).select("id").single();
      if (error || !data?.id) throw new Error(error?.message ?? "lead insert failed");

      const leadId = String(data.id);
      const activity = {
        org_id: row.orgId,
        lead_request_id: leadId,
        kind: row.status === "spam" ? "spam_quarantine" : "received",
        summary: row.status === "spam" ? "Quarantined as spam" : "Public form submission received",
        meta: { channel: "website_form", spam_score: row.spamScore },
      };
      const activityResult = await db.from("lead_activities").insert(activity).select("id").single();
      if (activityResult.error) {
        // Lead row already stored; activity is best-effort for intake.
        console.error("lead activity insert failed");
      }
      return { id: leadId };
    },
  };
}
