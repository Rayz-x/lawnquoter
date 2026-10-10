import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { LeadRequestRow, LeadStatus } from "./types";

type LeadError = { message: string; code?: string };

type LeadSelectBuilder = PromiseLike<{ data: LeadRequestRow[] | null; error: LeadError | null }> & {
  eq: (column: string, value: string) => LeadSelectBuilder;
  in: (column: string, values: string[]) => LeadSelectBuilder;
  is: (column: string, value: null) => LeadSelectBuilder;
  order: (column: string, options: { ascending: boolean }) => LeadSelectBuilder;
  limit: (count: number) => PromiseLike<{ data: LeadRequestRow[] | null; error: LeadError | null }>;
};

type LeadInsert = {
  org_id: string;
  status: LeadStatus;
  contact_name: string;
  phone: string | null;
  email: string | null;
  address_typed: string;
  source: string | null;
  source_other: string | null;
};

type LeadInsertBuilder = {
  select: (columns: string) => {
    single: () => PromiseLike<{ data: LeadRequestRow | null; error: LeadError | null }>;
  };
};

type LeadRequestsClient = {
  from: (table: "lead_requests") => {
    select: (columns: string) => LeadSelectBuilder;
    insert: (row: LeadInsert) => LeadInsertBuilder;
  };
};

/** Typed-ish adapter until `database.types` includes lead_requests. */
export function leadRequests(supabase: SupabaseClient<Database>) {
  return (supabase as unknown as LeadRequestsClient).from("lead_requests");
}
