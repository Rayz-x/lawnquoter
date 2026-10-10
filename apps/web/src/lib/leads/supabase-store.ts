import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadActivityRecord, LeadLostStore, LeadPipelineStatus, LeadRecord } from "./lost";

/**
 * Thin adapter over L01 `lead_requests` / `lead_activities`.
 * Tables are owned by L01 — this module does not migrate them.
 * Lost reason lives on the activity payload (L11 has no migration).
 */
type LeadQuery = {
  select: (columns: string) => LeadFilter;
  update: (values: Record<string, unknown>) => LeadFilter;
  insert: (values: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    };
  };
};

type LeadFilter = {
  eq: (column: string, value: string) => LeadFilter & {
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  };
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then?: Promise<{ error: { message: string } | null }>["then"];
};

type UntypedClient = {
  from: (table: string) => LeadQuery;
};

function asUntyped(supabase: SupabaseClient): UntypedClient {
  return supabase as unknown as UntypedClient;
}

function mapLead(row: Record<string, unknown>): LeadRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    status: String(row.status) as LeadPipelineStatus,
    lostReason: null,
    lostNote: null,
  };
}

export function createSupabaseLeadLostStore(supabase: SupabaseClient): LeadLostStore {
  const db = asUntyped(supabase);

  return {
    async getLead(leadId) {
      const { data, error } = await db.from("lead_requests").select("id, org_id, status").eq("id", leadId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return mapLead(data);
    },

    async saveLead(lead) {
      const result = await (db.from("lead_requests").update({ status: lead.status }).eq("id", lead.id).eq("org_id", lead.orgId) as unknown as Promise<{
        error: { message: string } | null;
      }>);
      if (result.error) throw new Error(result.error.message);
    },

    async appendActivity(activity) {
      const { data, error } = await db
        .from("lead_activities")
        .insert({
          lead_request_id: activity.leadId,
          org_id: activity.orgId,
          kind: activity.kind,
          payload: activity.payload,
        })
        .select("id, lead_request_id, org_id, kind, payload")
        .single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Activity insert returned no row.");
      const row: LeadActivityRecord = {
        id: String(data.id),
        leadId: String(data.lead_request_id),
        orgId: String(data.org_id),
        kind: String(data.kind),
        payload: (data.payload as Record<string, unknown>) ?? {},
      };
      return row;
    },
  };
}

/** Best-effort lookup; returns null when L01 tables are missing or the quote has no lead. */
export async function findLeadForQuote(
  supabase: SupabaseClient,
  input: { orgId: string; quoteId: string },
): Promise<{ id: string; status: LeadPipelineStatus } | null> {
  const db = asUntyped(supabase);
  try {
    const { data, error } = await db
      .from("lead_requests")
      .select("id, status")
      .eq("org_id", input.orgId)
      .eq("quote_id", input.quoteId)
      .maybeSingle();
    if (error || !data) return null;
    return { id: String(data.id), status: String(data.status) as LeadPipelineStatus };
  } catch {
    return null;
  }
}
