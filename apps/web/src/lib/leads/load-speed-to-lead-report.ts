import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingLeadRequestsRelation,
  mapLeadRequestToReportRow,
  type LeadRequestReportRaw,
} from "./lead-report-rows";
import { buildSpeedToLeadReport, type SourceReportRow } from "./speed-to-lead-report";

export type SpeedToLeadLoadResult =
  | { ok: true; rows: SourceReportRow[]; leadCount: number; available: true }
  | { ok: true; rows: SourceReportRow[]; leadCount: 0; available: false }
  | { ok: false; error: string };

type UntypedFrom = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        gte: (column: string, value: string) => {
          lt: (column: string, value: string) => {
            order: (
              column: string,
              opts: { ascending: boolean },
            ) => {
              limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    };
  };
};

/**
 * Loads lead rows for the date range and aggregates the report.
 * When L01 tables are not on the database yet, returns `available: false`
 * (empty stub) instead of inventing schema.
 */
export async function loadSpeedToLeadReport(
  supabase: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIsoExclusive: string,
): Promise<SpeedToLeadLoadResult> {
  const client = supabase as unknown as UntypedFrom;
  const { data, error } = await client
    .from("lead_requests")
    .select("created_at, first_contacted_at, source, status, quote_id, account_id")
    .eq("org_id", orgId)
    .gte("created_at", fromIso)
    .lt("created_at", toIsoExclusive)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    if (isMissingLeadRequestsRelation(error.message)) {
      return { ok: true, rows: [], leadCount: 0, available: false };
    }
    return { ok: false, error: error.message };
  }

  const mapped = (data ?? [])
    .map((raw) => mapLeadRequestToReportRow(raw as LeadRequestReportRaw))
    .filter((row): row is NonNullable<typeof row> => row != null);

  return {
    ok: true,
    rows: buildSpeedToLeadReport(mapped),
    leadCount: mapped.length,
    available: true,
  };
}
