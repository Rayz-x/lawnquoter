import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_LOST_REASON_LABELS, type LeadLostReason } from "@/lib/leads/lost";
import { isMissingLeadRequestsRelation } from "@/lib/leads/lead-report-rows";
import { defaultSelectedIds, sumSelected } from "@/lib/quotes/selection";
import type { Database } from "@/lib/supabase/database.types";
import {
  estimatedVsActual,
  funnelByRep,
  funnelByService,
  funnelBySource,
  marginBy,
  overallFunnel,
  pipelineForecast,
  pipelineValue,
  routeDensity,
  widgetStages,
  winLoss,
  type LaborOutcome,
  type SalesLead,
  type WidgetEvent,
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
      variance: ReturnType<typeof estimatedVsActual>;
      density: ReturnType<typeof routeDensity>;
      widget: ReturnType<typeof widgetStages>;
      marginByService: ReturnType<typeof marginBy>;
      marginByCrew: ReturnType<typeof marginBy>;
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
      "id, source, source_other, assignee_id, services, status, lost_reason, created_at, updated_at, quote_id, first_contacted_at, postal_code, address_typed, out_of_area, email, phone, landing_page",
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
  const [profiles, linkedQuotes, acceptances, deposits] = await Promise.all([
    assigneeIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", assigneeIds)
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? supabase.from("quotes").select("id, status, updated_at, viewed_at").in("id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? supabase.from("acceptances").select("quote_id, accepted_at").in("quote_id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? supabase
          .from("payment_intents")
          .select("quote_id")
          .eq("org_id", orgId)
          .eq("kind", "deposit")
          .eq("status", "succeeded")
          .in("quote_id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) return { ok: false, error: profiles.error.message };
  if (linkedQuotes.error) return { ok: false, error: linkedQuotes.error.message };
  if (acceptances.error) return { ok: false, error: acceptances.error.message };
  if (deposits.error) return { ok: false, error: deposits.error.message };

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
  const viewed = new Set((linkedQuotes.data ?? []).filter((quote) => quote.viewed_at).map((quote) => quote.id));
  const paid = new Set((deposits.data ?? []).map((payment) => payment.quote_id).filter((id): id is string => Boolean(id)));
  const widgetEvents: WidgetEvent[] = rawLeads
    .filter((lead) => isWidgetLead(lead.source, lead.landing_page))
    .map((lead) => ({
      addressEntered: Boolean(lead.address_typed.trim()),
      qualified: !lead.out_of_area && lead.status !== "spam",
      contactCaptured: Boolean(lead.email || lead.phone),
      quoteViewed: lead.quote_id ? viewed.has(lead.quote_id) : false,
      depositPaid: lead.quote_id ? paid.has(lead.quote_id) : false,
    }));
  const outcomes = await loadOutcomes(
    supabase,
    orgId,
    fromIso,
    toIsoExclusive,
    rawLeads.map((lead) => ({ postalCode: lead.postal_code, status: lead.status })),
  );

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
    variance: outcomes.variance,
    density: outcomes.density,
    widget: widgetStages(widgetEvents),
    marginByService: marginBy(outcomes.labor, (row) => row.service),
    marginByCrew: marginBy(outcomes.labor, (row) => row.crew),
  };
}

function isWidgetLead(source: string | null, landingPage: string | null): boolean {
  const label = (source ?? "").trim().toLowerCase();
  return label.includes("widget") || label === "website form" || Boolean(landingPage);
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

async function loadOutcomes(
  supabase: Client,
  orgId: string,
  fromIso: string,
  toIsoExclusive: string,
  leadZips: { postalCode: string | null; status: string }[],
) {
  const fromDate = fromIso.slice(0, 10);
  const toDate = toIsoExclusive.slice(0, 10);
  const [entries, visits, rate] = await Promise.all([
    supabase
      .from("time_entries")
      .select("visit_id, crew_id, started_at, ended_at")
      .eq("org_id", orgId)
      .eq("kind", "job")
      .gte("started_at", fromIso)
      .lt("started_at", toIsoExclusive)
      .limit(2000),
    supabase
      .from("visits")
      .select("id, property_id, job_id, budget_minutes")
      .eq("org_id", orgId)
      .gte("occurrence_date", fromDate)
      .lt("occurrence_date", toDate)
      .limit(2000),
    supabase.from("labor_rates").select("hourly_rate, burden_pct").eq("org_id", orgId).limit(1),
  ]);
  const jobs = (entries.data ?? []).filter((entry) => entry.visit_id && entry.ended_at);
  const visitIds = ids(jobs.map((entry) => entry.visit_id));
  const propertyIds = ids((visits.data ?? []).map((visit) => visit.property_id));
  const jobIds = ids((visits.data ?? []).map((visit) => visit.job_id));
  const [crews, invoices, jobRows, properties] = await Promise.all([
    ids(jobs.map((entry) => entry.crew_id)).length
      ? supabase.from("crews").select("id, name").in("id", ids(jobs.map((entry) => entry.crew_id)))
      : Promise.resolve({ data: [] }),
    visitIds.length
      ? supabase.from("invoice_lines").select("visit_id, amount_cents").in("visit_id", visitIds)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabase.from("jobs").select("id, service_id, title").in("id", jobIds)
      : Promise.resolve({ data: [] }),
    propertyIds.length
      ? supabase.from("properties").select("id, postal_code").in("id", propertyIds)
      : Promise.resolve({ data: [] }),
  ]);
  const serviceIds = ids((jobRows.data ?? []).map((job) => job.service_id));
  const { data: services } = serviceIds.length
    ? await supabase.from("services").select("id, name").in("id", serviceIds)
    : { data: [] };
  const crewNames = new Map((crews.data ?? []).map((crew) => [crew.id, crew.name]));
  const visitById = new Map((visits.data ?? []).map((visit) => [visit.id, visit]));
  const serviceName = new Map((services ?? []).map((service) => [service.id, service.name]));
  const jobService = new Map(
    (jobRows.data ?? []).map((job) => [job.id, (job.service_id && serviceName.get(job.service_id)) || job.title]),
  );
  const revenue = new Map<string, number>();
  for (const line of invoices.data ?? []) {
    if (!line.visit_id) continue;
    revenue.set(line.visit_id, (revenue.get(line.visit_id) ?? 0) + line.amount_cents);
  }
  const shares = new Map<string, number>();
  for (const entry of jobs) shares.set(entry.visit_id!, (shares.get(entry.visit_id!) ?? 0) + 1);
  const hourly = rate.data?.[0];
  const burden = hourly ? 1 + Number(hourly.burden_pct) / 100 : null;
  const labor: LaborOutcome[] = jobs.map((entry) => {
    const minutes = Math.max(
      0,
      Math.round((new Date(entry.ended_at!).getTime() - new Date(entry.started_at).getTime()) / 60_000),
    );
    const visitShares = shares.get(entry.visit_id!) ?? 1;
    const visit = visitById.get(entry.visit_id!);
    return {
      service: (visit && jobService.get(visit.job_id)) || "Unspecified",
      crew: crewNames.get(entry.crew_id) ?? "Unassigned",
      revenueCents: Math.round((revenue.get(entry.visit_id!) ?? 0) / visitShares),
      laborMinutes: minutes,
      laborCostCents:
        hourly && burden != null ? Math.round((minutes / 60) * Number(hourly.hourly_rate) * burden * 100) : null,
    };
  });
  const zips = new Map((properties.data ?? []).map((property) => [property.id, property.postal_code]));
  return {
    variance: estimatedVsActual(
      jobs.map((entry) => {
        const visit = visitById.get(entry.visit_id!);
        const visitShares = shares.get(entry.visit_id!) ?? 1;
        const minutes = Math.max(
          0,
          Math.round((new Date(entry.ended_at!).getTime() - new Date(entry.started_at).getTime()) / 60_000),
        );
        return {
          crew: crewNames.get(entry.crew_id) ?? "Unassigned",
          estimatedMinutes: Math.round((visit?.budget_minutes ?? 0) / visitShares),
          actualMinutes: minutes,
        };
      }),
    ),
    labor,
    density: routeDensity([
      ...leadZips,
      ...(visits.data ?? []).map((visit) => ({ postalCode: zips.get(visit.property_id) ?? null })),
    ]),
  };
}
