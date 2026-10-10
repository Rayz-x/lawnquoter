import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type LeadTable = "lead_requests" | "lead_activities" | "org_lead_settings";

/** Chainable stub until L01 regenerates `database.types`. */
type LeadQuery = {
  select: (...args: unknown[]) => LeadQuery;
  insert: (values: unknown) => LeadQuery;
  update: (values: unknown) => LeadQuery;
  eq: (...args: unknown[]) => LeadQuery;
  order: (...args: unknown[]) => LeadQuery;
  limit: (...args: unknown[]) => LeadQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: (
    onfulfilled?: (value: { data: unknown; error: { message: string } | null }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

type LeadClient = {
  from: (relation: LeadTable) => LeadQuery;
};

/**
 * Thin adapter for L01 lead tables. Local contract only — do not ship a
 * duplicate migration; regenerate types after L01 merges.
 */
export function leadsClient(supabase: SupabaseClient<Database>): LeadClient {
  return supabase as unknown as LeadClient;
}
