import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_LOST_REASON_LABELS, type LeadLostReason } from "@/lib/leads/lost";
import { isMissingLeadRequestsRelation } from "@/lib/leads/lead-report-rows";
import { defaultSelectedIds, sumSelected } from "@/lib/quotes/selection";
import type { Database } from "@/lib/supabase/database.types";
import {
  funnelByRep,
  funnelByService,
  funnelBySource,
  overallFunnel,
  pipelineForecast,
  pipelineValue,
  winLoss,
  type SalesLead,
} from "./sales-analytics";

type Client = SupabaseClient<Database>;

export type SalesAnalyticsLoad =
  | { ok: true; available: false }
  | {
      ok: true;
      available: true;
      bySource: ReturnType<typeof funnelBySource>;
      byRep: ReturnType<typeof funnelByRep>;
      byService: ReturnType<typeof funnelByService>;
      losses: ReturnType<typeof winLoss>;
      forecast: ReturnType<typeof pipelineForecast>;
      pipeline: ReturnType<typeof pipelineValue>;
      medianResponseMinutes: number | null;
      leadCount: number;
    }
  | { ok: false; error: string };

function ids(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function lostLabel(reason: string | null): string | null {
  if (!reason) return null;
  return reason in LEAD_LOST_REASON_LABELS
    ? LEAD_LOST_REASON_LABELS[reason as LeadLostReason]
    : reason;
}

const QUOTED_QUOTE_STATUSES = new Set(["sent", "viewed", "accepted", "declined", "expired", "changed"]);

export async function loadSalesAnalytics(
  supabase: Client,
  orgId: string,
  fromIso: string,
  toIsoExclusive: string,
  now = new Date(),
): Promise<SalesAnalyticsLoad> {
  const leadsQuery = await supabase
    .from("lead_requests")
    .select(
      "id, source, source_other, assignee_id, services, status, lost_reason, created_at, updated_at, quote_id, first_contacted_at",
    )
    .eq("org_id", orgId)
    .gte("created_at", fromIso)
    .lt("created_at", toIsoExclusive)
    .limit(2000);

  if (leadsQuery.error) {
    if (isMissingLeadRequestsRelation(leadsQuery.error.message)) return { ok: true, available: false };
    return { ok: false, error: leadsQuery.error.message };
  }

  const rawLeads = leadsQuery.data ?? [];
  const assigneeIds = ids(rawLeads.map((lead) => lead.assignee_id));
  const quoteIds = ids(rawLeads.map((lead) => lead.quote_id));
  const [profiles, linkedQuotes, acceptances] = await Promise.all([
    assigneeIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", assigneeIds)
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? supabase.from("quotes").select("id, status, updated_at").in("id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? supabase.from("acceptances").select("quote_id, accepted_at").in("quote_id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) return { ok: false, error: profiles.error.message };
  if (linkedQuotes.error) return { ok: false, error: linkedQuotes.error.message };
  if (acceptances.error) return { ok: false, error: acceptances.error.message };

  const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.full_name]));
  const quoteById = new Map((linkedQuotes.data ?? []).map((quote) => [quote.id, quote]));
  const acceptedAt = new Map<string, string>();
  for (const acceptance of acceptances.data ?? []) {
    const current = acceptedAt.get(acceptance.quote_id);
    if (!current || acceptance.accepted_at < current) acceptedAt.set(acceptance.quote_id, acceptance.accepted_at);
  }

  const leads: SalesLead[] = rawLeads.map((lead) => {
    const quote = lead.quote_id ? quoteById.get(lead.quote_id) : undefined;
    const won = lead.status === "won" || quote?.status === "accepted";
    const quoted =
      won || lead.status === "quoted" || (quote ? QUOTED_QUOTE_STATUSES.has(quote.status) : false);
    const source =
      lead.source === "Other" && lead.source_other?.trim() ? lead.source_other.trim() : lead.source;
    return {
      id: lead.id,
      source,
      assignee: lead.assignee_id ? names.get(lead.assignee_id) || "Unassigned" : null,
      service: lead.services[0] ?? null,
      status: lead.status === "spam" || lead.status === "lost" ? lead.status : won ? "won" : quoted ? "quoted" : lead.status,
      lostReason: lostLabel(lead.lost_reason),
      createdAt: lead.created_at,
      closedAt: won ? (acceptedAt.get(quote?.id ?? "") ?? quote?.updated_at ?? lead.updated_at) : null,
      quotedAt: quoted ? (quote?.updated_at ?? lead.updated_at) : null,
      firstContactedAt: lead.first_contacted_at,
    };
  });

  const pipeline = await loadForecast(supabase, orgId, now);
  if (!pipeline.ok) return pipeline;
  const overall = overallFunnel(leads);

  return {
    ok: true,
    available: true,
    bySource: funnelBySource(leads),
    byRep: funnelByRep(leads),
    byService: funnelByService(leads),
    losses: winLoss(leads),
    forecast: pipeline.forecast,
    pipeline: pipeline.pipeline,
    medianResponseMinutes: overall.medianResponseMinutes,
    leadCount: overall.leads,
  };
}

async function loadForecast(supabase: Client, orgId: string, now: Date) {
  const open = await supabase
    .from("quotes")
    .select("id, created_at, expires_at, current_version")
    .eq("org_id", orgId)
    .in("status", ["draft", "sent", "viewed", "changed"])
    .limit(200);
  if (open.error) return { ok: false as const, error: open.error.message };
  const quotes = open.data ?? [];
  const quoteIds = ids(quotes.map((quote) => quote.id));
  const empty = { ok: true as const, forecast: pipelineForecast([], now), pipeline: pipelineValue([]) };
  if (quoteIds.length === 0) return empty;

  const versions = await supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", quoteIds);
  if (versions.error) return { ok: false as const, error: versions.error.message };
  const current = new Map<string, string>();
  for (const quote of quotes) {
    const version = (versions.data ?? []).find(
      (row) => row.quote_id === quote.id && row.version === quote.current_version,
    );
    if (version) current.set(quote.id, version.id);
  }
  const versionIds = [...current.values()];
  const lines = versionIds.length
    ? await supabase
        .from("quote_line_items")
        .select("id, version_id, state, selected, option_group, price")
        .in("version_id", versionIds)
    : { data: [], error: null };
  if (lines.error) return { ok: false as const, error: lines.error.message };

  const openQuotes = quotes.map((quote) => {
    const items = (lines.data ?? []).filter((line) => line.version_id === current.get(quote.id));
    const cents = Math.round(sumSelected(items, defaultSelectedIds(items), "price") * 100);
    return { id: quote.id, cents, createdAt: quote.created_at, expectedCloseAt: quote.expires_at };
  });
  return {
    ok: true as const,
    forecast: pipelineForecast(openQuotes, now),
    pipeline: pipelineValue(openQuotes),
  };
}
