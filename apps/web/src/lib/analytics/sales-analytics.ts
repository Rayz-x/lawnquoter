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
