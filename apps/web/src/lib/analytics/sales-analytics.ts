export type SalesLead = {
  id: string;
  source: string | null;
  assignee: string | null;
  service: string | null;
  status: "new" | "contacted" | "quoted" | "won" | "lost" | "spam";
  lostReason: string | null;
  createdAt: string;
  closedAt: string | null;
  quotedAt: string | null;
  firstContactedAt?: string | null;
};

export type OpenQuote = {
  id: string;
  cents: number;
  createdAt: string;
  expectedCloseAt: string | null;
};

export type FunnelSlice = {
  key: string;
  leads: number;
  quoted: number;
  accepted: number;
  quoteRate: number;
  acceptRate: number;
  medianDaysToClose: number | null;
  medianResponseMinutes: number | null;
};

const QUOTED = new Set(["quoted", "won"]);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return Math.round(value);
}

function daysBetween(start: string, end: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000,
    ),
  );
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function slice(leads: SalesLead[], key: string): FunnelSlice {
  const live = leads.filter((lead) => lead.status !== "spam");
  const quoted = live.filter(
    (lead) => QUOTED.has(lead.status) || lead.quotedAt !== null,
  );
  const accepted = live.filter((lead) => lead.status === "won");
  const closeDays = accepted
    .filter((lead) => lead.closedAt !== null)
    .map((lead) => daysBetween(lead.createdAt, lead.closedAt ?? lead.createdAt));
  const responseMinutes = live.flatMap((lead) => {
    if (!lead.firstContactedAt) return [];
    const delta =
      new Date(lead.firstContactedAt).getTime() - new Date(lead.createdAt).getTime();
    if (!Number.isFinite(delta) || delta < 0) return [];
    return [Math.round(delta / 60_000)];
  });
  return {
    key,
    leads: live.length,
    quoted: quoted.length,
    accepted: accepted.length,
    quoteRate: rate(quoted.length, live.length),
    acceptRate: rate(accepted.length, quoted.length),
    medianDaysToClose: median(closeDays),
    medianResponseMinutes: median(responseMinutes),
  };
}

function group(
  leads: SalesLead[],
  keyOf: (lead: SalesLead) => string,
): FunnelSlice[] {
  const buckets = new Map<string, SalesLead[]>();
  for (const lead of leads) {
    const key = keyOf(lead).trim() || "Unspecified";
    buckets.set(key, [...(buckets.get(key) ?? []), lead]);
  }
  return [...buckets.entries()]
    .map(([key, rows]) => slice(rows, key))
    .sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key));
}

export function funnelBySource(leads: SalesLead[]): FunnelSlice[] {
  return group(leads, (lead) => lead.source ?? "Unknown");
}

export function funnelByRep(leads: SalesLead[]): FunnelSlice[] {
  return group(leads, (lead) => lead.assignee ?? "Unassigned");
}

export function funnelByService(leads: SalesLead[]): FunnelSlice[] {
  return group(leads, (lead) => lead.service ?? "Unspecified");
}

export function overallFunnel(leads: SalesLead[]): FunnelSlice {
  return slice(leads, "All");
}

export function winLoss(leads: SalesLead[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    if (lead.status !== "lost") continue;
    const reason = lead.lostReason?.trim() || "No reason";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export type ForecastMonth = { month: string; cents: number; quotes: number };

export function pipelineForecast(quotes: OpenQuote[], now = new Date()): ForecastMonth[] {
  const months = new Map<string, ForecastMonth>();
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const month = date.toISOString().slice(0, 7);
    months.set(month, { month, cents: 0, quotes: 0 });
  }
  for (const quote of quotes) {
    const close = quote.expectedCloseAt ?? quote.createdAt;
    const month = close.slice(0, 7);
    const bucket = months.get(month);
    if (!bucket) continue;
    bucket.cents += quote.cents;
    bucket.quotes += 1;
  }
  return [...months.values()];
}

export function pipelineValue(quotes: OpenQuote[]): { cents: number; quotes: number } {
  return {
    cents: quotes.reduce((sum, quote) => sum + quote.cents, 0),
    quotes: quotes.length,
  };
}

export type JobVariance = { crew: string; estimatedMinutes: number; actualMinutes: number };

export function estimatedVsActual(rows: JobVariance[]) {
  const crews = new Map<string, { estimated: number; actual: number }>();
  for (const row of rows) {
    const crew = row.crew.trim() || "Unassigned";
    const current = crews.get(crew) ?? { estimated: 0, actual: 0 };
    current.estimated += row.estimatedMinutes;
    current.actual += row.actualMinutes;
    crews.set(crew, current);
  }
  return [...crews.entries()]
    .map(([crew, totals]) => ({
      crew,
      estimatedHours: Math.round((totals.estimated / 60) * 10) / 10,
      actualHours: Math.round((totals.actual / 60) * 10) / 10,
      varianceHours: Math.round(((totals.actual - totals.estimated) / 60) * 10) / 10,
    }))
    .sort((a, b) => b.actualHours - a.actualHours || a.crew.localeCompare(b.crew));
}

export function routeDensity(rows: { postalCode: string | null; status?: string }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "spam" || !row.postalCode?.trim()) continue;
    const code = row.postalCode.trim().slice(0, 5);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([postalCode, count]) => ({ postalCode, count }))
    .sort((a, b) => b.count - a.count || a.postalCode.localeCompare(b.postalCode));
}

export type WidgetEvent = {
  addressEntered: boolean;
  qualified: boolean;
  contactCaptured: boolean;
  quoteViewed: boolean;
  depositPaid: boolean;
};

const WIDGET_STAGES: { stage: string; pick: (event: WidgetEvent) => boolean }[] = [
  { stage: "Address entered", pick: (event) => event.addressEntered },
  { stage: "Qualified", pick: (event) => event.qualified },
  { stage: "Contact captured", pick: (event) => event.contactCaptured },
  { stage: "Quote viewed", pick: (event) => event.quoteViewed },
  { stage: "Deposit", pick: (event) => event.depositPaid },
];

export function widgetStages(events: WidgetEvent[]) {
  const start = events.filter((event) => event.addressEntered).length;
  return WIDGET_STAGES.map(({ stage, pick }) => {
    const count = events.filter(pick).length;
    return { stage, count, fromStart: rate(count, start) };
  });
}

export type LaborOutcome = {
  service: string;
  crew: string;
  revenueCents: number;
  laborMinutes: number;
  laborCostCents: number | null;
};

export function densityPoints(
  counts: { propertyId: string; count: number }[],
  coordinates: { id: string; lng: number; lat: number }[],
): { lng: number; lat: number; weight: number }[] {
  const byId = new Map(coordinates.map((row) => [row.id, row]));
  const totals = new Map<string, number>();
  for (const row of counts) {
    if (row.count <= 0) continue;
    totals.set(row.propertyId, (totals.get(row.propertyId) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .flatMap(([id, weight]) => {
      const point = byId.get(id);
      if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return [];
      return [{ lng: point.lng, lat: point.lat, weight }];
    })
    .sort((a, b) => b.weight - a.weight || a.lng - b.lng);
}

export function marginBy(rows: LaborOutcome[], keyOf: (row: LaborOutcome) => string) {
  const buckets = new Map<string, { revenue: number; minutes: number; cost: number | null }>();
  for (const row of rows) {
    const key = keyOf(row).trim() || "Unspecified";
    const current = buckets.get(key) ?? { revenue: 0, minutes: 0, cost: 0 };
    current.revenue += row.revenueCents;
    current.minutes += row.laborMinutes;
    if (row.laborCostCents == null) current.cost = null;
    else if (current.cost != null) current.cost += row.laborCostCents;
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .map(([key, totals]) => ({
      key,
      revenueCents: totals.revenue,
      dollarsPerManHour:
        totals.minutes <= 0 ? null : Math.round((totals.revenue / 100 / (totals.minutes / 60)) * 100) / 100,
      marginPercent:
        totals.cost == null || totals.revenue <= 0
          ? null
          : Math.round(((totals.revenue - totals.cost) / totals.revenue) * 100),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.key.localeCompare(b.key));
}
