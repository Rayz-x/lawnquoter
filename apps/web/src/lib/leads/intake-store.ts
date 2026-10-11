import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/supabase/database.types";
import { createEmailProvider } from "@/lib/email/provider";
import type { MatchCandidateInput, OpenLeadForFold } from "./dedupe";
import { DEFAULT_RESPONSE_TARGET_MINUTES } from "./age-badge";
import { sendQueuedNewLeadEmails } from "./new-lead-notify";
import { normalizeEmail, normalizePhoneE164 } from "./normalize-contact";
import { responseTargetMinutes } from "./response-target";
import type { LeadIntakeDeps, LeadIntakeInsert, LeadIntakeOrg } from "./submit-request";

type UntypedFrom = {
  select: (columns: string, opts?: { count?: "exact"; head?: boolean }) => UntypedFilter;
  insert: (values: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    };
  };
  update: (values: Record<string, unknown>) => UntypedFilter;
};

type UntypedFilter = {
  eq: (column: string, value: string) => UntypedFilter;
  in: (column: string, values: string[]) => UntypedFilter;
  gte: (column: string, value: string) => UntypedFilter;
  ilike: (column: string, value: string) => UntypedFilter;
  or: (filter: string) => UntypedFilter;
  filter: (column: string, op: string, value: string) => UntypedFilter;
  order: (column: string, opts?: { ascending?: boolean }) => UntypedFilter;
  limit: (n: number) => UntypedFilter;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  select: (columns: string) => UntypedFilter;
  then: (
    onfulfilled?: (value: {
      data?: Record<string, unknown>[] | null;
      count?: number | null;
      error: { message: string } | null;
    }) => unknown,
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

function settingsZipList(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") return [];
  const value = (settings as Record<string, unknown>).lead_service_area_zips;
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
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

async function resolveProfileEmail(client: UntypedClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await client.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (typeof data?.email === "string" && data.email.trim()) return data.email.trim();
  return null;
}

/** L08 notify hook: assignee email, else org office email; confirmation to requester only. */
export function createNotifyNewLead(
  admin: SupabaseClient,
  send?: ReturnType<typeof createEmailProvider>["send"],
): NonNullable<LeadIntakeDeps["notifyNewLead"]> {
  const db = asUntyped(admin);
  const provider = createEmailProvider();
  const sendMail = send ?? ((message) => provider.send(message));

  return async ({ status, row, org }) => {
    if (status !== "new") return;
    const assigneeEmail = await resolveProfileEmail(db, row.assigneeId);
    const officeTo = assigneeEmail ?? org.officeEmail;
    await sendQueuedNewLeadEmails(
      {
        status,
        officeTo,
        requesterEmail: row.email,
        orgName: org.name,
        contactName: row.contactName,
        addressTyped: row.addressTyped,
        services: row.services,
        phone: row.phone,
        replyWithinMinutes: org.responseTargetMinutes,
      },
      sendMail,
    );
  };
}

export function createLeadIntakeStore(
  admin: SupabaseClient,
): Pick<
  LeadIntakeDeps,
  | "findOrgBySlug"
  | "countRecentByIpHash"
  | "countRecentByOrg"
  | "insertLead"
  | "listOpenLeadsForFold"
  | "listMatchCandidates"
  | "foldIntoLead"
> {
  const db = asUntyped(admin);

  return {
    async findOrgBySlug(slug: string): Promise<LeadIntakeOrg | null> {
      const { data, error } = await db
        .from("orgs")
        .select("id, name, email, settings")
        .filter("settings->>lead_form_slug", "eq", slug)
        .maybeSingle();
      if (error || !data) return null;
      const orgId = String(data.id);
      const consentTextVersion = settingsText(data.settings, "lead_consent_text_version") ?? "v1";
      const defaultAssigneeId = await resolveDefaultAssignee(db, orgId, data.settings);
      const serviceAreaZips = settingsZipList(data.settings);
      const officeEmail =
        typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
      const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Office";
      return {
        orgId,
        name,
        officeEmail,
        consentTextVersion,
        defaultAssigneeId,
        serviceAreaZips,
        responseTargetMinutes:
          responseTargetMinutes(data.settings as Json) || DEFAULT_RESPONSE_TARGET_MINUTES,
      };
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

    async listOpenLeadsForFold(orgId, sinceIso): Promise<OpenLeadForFold[]> {
      const result = (await db
        .from("lead_requests")
        .select("id, phone, email, status, created_at")
        .eq("org_id", orgId)
        .in("status", ["new", "contacted", "quoted"])
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(50)) as {
        data: Array<{
          id: string;
          phone: string | null;
          email: string | null;
          status: string;
          created_at: string;
        }> | null;
        error: { message: string } | null;
      };
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []).map((row) => ({
        id: String(row.id),
        phone: row.phone,
        email: row.email,
        status: String(row.status),
        createdAtMs: Date.parse(row.created_at),
      }));
    },

    async listMatchCandidates(orgId, probe): Promise<MatchCandidateInput[]> {
      const phone = normalizePhoneE164(probe.phone);
      const email = normalizeEmail(probe.email);
      const out: MatchCandidateInput[] = [];
      const seen = new Set<string>();

      const pushAccount = (
        account: {
          id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
        },
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
        const accountResult = (await db
          .from("accounts")
          .select("id, name, phone, email")
          .eq("org_id", orgId)
          .or(filters.join(","))
          .limit(20)) as {
          data: Array<{ id: string; name: string | null; phone: string | null; email: string | null }> | null;
          error: { message: string } | null;
        };
        if (accountResult.error) throw new Error(accountResult.error.message);
        for (const account of accountResult.data ?? []) {
          const propsResult = (await db
            .from("properties")
            .select("id, address_line1, city, postal_code, formatted_address")
            .eq("org_id", orgId)
            .eq("account_id", account.id)
            .limit(10)) as {
            data: Array<{
              id: string;
              address_line1: string | null;
              city: string | null;
              postal_code: string | null;
              formatted_address: string | null;
            }> | null;
            error: { message: string } | null;
          };
          if (propsResult.error) throw new Error(propsResult.error.message);
          const props = propsResult.data ?? [];
          if (!props.length) {
            pushAccount(account, null, null);
          } else {
            for (const property of props) pushAccount(account, property, null);
          }
        }
      }

      if (probe.addressLine1) {
        const propResult = (await db
          .from("properties")
          .select("id, account_id, address_line1, city, postal_code, formatted_address")
          .eq("org_id", orgId)
          .ilike("address_line1", probe.addressLine1)
          .limit(20)) as {
          data: Array<{
            id: string;
            account_id: string;
            address_line1: string | null;
            city: string | null;
            postal_code: string | null;
            formatted_address: string | null;
          }> | null;
          error: { message: string } | null;
        };
        if (propResult.error) throw new Error(propResult.error.message);
        for (const property of propResult.data ?? []) {
          const accountResult = (await db
            .from("accounts")
            .select("id, name, phone, email")
            .eq("id", property.account_id)
            .eq("org_id", orgId)
            .maybeSingle()) as {
            data: { id: string; name: string | null; phone: string | null; email: string | null } | null;
            error: { message: string } | null;
          };
          if (accountResult.error) throw new Error(accountResult.error.message);
          if (!accountResult.data) continue;
          const samePostal =
            !probe.postalCode ||
            !property.postal_code ||
            property.postal_code.replace(/\s+/g, "").toLowerCase() ===
              probe.postalCode.replace(/\s+/g, "").toLowerCase();
          pushAccount(accountResult.data, property, samePostal ? 0 : null);
        }
      }

      return out;
    },

    async foldIntoLead({ leadId, orgId, note, services, addressTyped }) {
      const existing = (await db
        .from("lead_requests")
        .select("id, note, services")
        .eq("id", leadId)
        .eq("org_id", orgId)
        .maybeSingle()) as {
        data: { id: string; note: string | null; services: string[] | null } | null;
        error: { message: string } | null;
      };
      if (existing.error || !existing.data) throw new Error(existing.error?.message ?? "fold lead missing");

      const priorNote = existing.data.note?.trim() || "";
      const mergedNote = [priorNote, note?.trim() ? `Repeat submit: ${note.trim()}` : "Repeat submit (folded)"]
        .filter(Boolean)
        .join("\n")
        .slice(0, 5000);
      const priorServices = Array.isArray(existing.data.services) ? existing.data.services : [];
      const mergedServices = [...priorServices];
      for (const service of services) {
        if (!mergedServices.includes(service) && mergedServices.length < 32) mergedServices.push(service);
      }

      const updateResult = (await db
        .from("lead_requests")
        .update({ note: mergedNote || null, services: mergedServices })
        .eq("id", leadId)
        .eq("org_id", orgId)
        .select("id")) as unknown as { data: { id: string }[] | null; error: { message: string } | null };
      if (updateResult.error) throw new Error(updateResult.error.message);

      const activityResult = await db
        .from("lead_activities")
        .insert({
          org_id: orgId,
          lead_request_id: leadId,
          kind: "repeat_folded",
          summary: "Repeat submission folded into this request",
          meta: { channel: "website_form", address_typed: addressTyped },
        })
        .select("id")
        .single();
      if (activityResult.error) console.error("fold activity insert failed");

      return { id: leadId };
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
        needs_address_check: row.needsAddressCheck,
        out_of_area: row.outOfArea,
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
        account_id: row.accountId,
        property_id: row.propertyId,
      };
      // PostgREST cannot round-trip geography on insert; pin lives in geocode_raw.

      const { data, error } = await db.from("lead_requests").insert(payload).select("id").single();
      if (error || !data?.id) throw new Error(error?.message ?? "lead insert failed");

      const leadId = String(data.id);
      const activity = {
        org_id: row.orgId,
        lead_request_id: leadId,
        kind: row.status === "spam" ? "spam_quarantine" : "received",
        summary: row.status === "spam"
          ? "Quarantined as spam"
          : row.outOfArea
            ? "Public form submission received (may be outside service area)"
            : row.needsAddressCheck
              ? "Public form submission received (needs address check)"
              : "Public form submission received",
        meta: {
          channel: "website_form",
          spam_score: row.spamScore,
          needs_address_check: row.needsAddressCheck,
          out_of_area: row.outOfArea,
          ...(row.accountId && row.propertyId
            ? { auto_linked_account_id: row.accountId, auto_linked_property_id: row.propertyId }
            : {}),
        },
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
