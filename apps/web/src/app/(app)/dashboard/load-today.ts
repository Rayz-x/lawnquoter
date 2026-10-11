import { addDays } from "@/lib/scheduling/recurrence";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";

export type AttentionItem = {
  id: string;
  href: string;
  title: string;
  detail: string;
  action: string;
};

export type MotionQuote = {
  id: string;
  number: number;
  customer: string;
  work: string;
  place: string;
  status: string;
  siteCheck: boolean;
  total: number;
  updated: string;
};

export type CrewRow = {
  name: string;
  done: number;
  total: number;
  note: string;
};

export type TodayData = {
  todayLabel: string;
  quotesOut: number;
  quotesOutCount: number;
  acceptedWeek: number;
  acceptedPrior: number;
  stopsDone: number;
  stopsTotal: number;
  attention: AttentionItem[];
  motion: MotionQuote[];
  crews: CrewRow[];
  week: { label: string; total: number }[];
  error: string | null;
};

type MoneyQuote = {
  id: string;
  number: number;
  title: string;
  status: string;
  site_check_status: string | null;
  updated_at: string;
  current_version: number;
  accounts: { name: string } | null;
  properties: { address_line1: string } | null;
  quote_versions: { version: number; quote_line_items: { price: number; selected: boolean }[] | null }[] | null;
};

function totalOf(quote: MoneyQuote) {
  const version =
    quote.quote_versions?.find((row) => row.version === quote.current_version) ?? quote.quote_versions?.[0];
  return (version?.quote_line_items ?? []).reduce((sum, line) => sum + (line.selected ? Number(line.price) : 0), 0);
}

function dayLabel(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" });
}

export async function loadToday(orgId: string): Promise<TodayData> {
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", orgId).maybeSingle();
  const zone = org?.timezone ?? "UTC";
  const today = orgToday(zone);
  const weekStart = addDays(today, -6);
  const priorStart = addDays(today, -13);
  const empty: TodayData = {
    todayLabel: new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    quotesOut: 0,
    quotesOutCount: 0,
    acceptedWeek: 0,
    acceptedPrior: 0,
    stopsDone: 0,
    stopsTotal: 0,
    attention: [],
    motion: [],
    crews: [],
    week: Array.from({ length: 7 }, (_, index) => ({ label: dayLabel(addDays(weekStart, index)), total: 0 })),
    error: null,
  };

  const [openQuotes, accepted, visits, leads] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, number, title, status, site_check_status, updated_at, current_version, accounts(name), properties(address_line1), quote_versions(version, quote_line_items(price, selected))",
      )
      .eq("org_id", orgId)
      .in("status", ["draft", "sent", "viewed", "changed"])
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("quotes")
      .select("id, status, updated_at, current_version, quote_versions(version, quote_line_items(price, selected))")
      .eq("org_id", orgId)
      .eq("status", "accepted")
      .gte("updated_at", `${priorStart}T00:00:00.000Z`)
      .limit(80),
    supabase
      .from("visits")
      .select("id, status, scheduled_date, routes(crews(name)), properties(address_line1)")
      .eq("org_id", orgId)
      .eq("scheduled_date", today)
      .neq("status", "cancelled"),
    supabase
      .from("lead_requests")
      .select("id, contact_name, address_typed, status")
      .eq("org_id", orgId)
      .in("status", ["new", "contacted"])
      .order("created_at", { ascending: true })
      .limit(4),
  ]);

  const error = openQuotes.error?.message ?? accepted.error?.message ?? visits.error?.message ?? leads.error?.message ?? null;
  const open = (openQuotes.data ?? []) as unknown as MoneyQuote[];
  const won = (accepted.data ?? []) as unknown as Pick<MoneyQuote, "updated_at" | "current_version" | "quote_versions">[];
  const out = open.filter((quote) => quote.status === "sent" || quote.status === "viewed" || quote.status === "changed");
  empty.quotesOutCount = out.length;
  empty.quotesOut = out.reduce((sum, quote) => sum + totalOf(quote), 0);

  for (const quote of won) {
    const day = orgToday(zone, new Date(quote.updated_at));
    const amount = totalOf(quote as MoneyQuote);
    if (day >= weekStart) empty.acceptedWeek += amount;
    else empty.acceptedPrior += amount;
    if (day >= weekStart && day <= today) {
      const offset = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86400000);
      const bar = empty.week[offset];
      if (bar) bar.total += amount;
    }
  }

  const visitRows = (visits.data ?? []) as unknown as {
    id: string;
    status: string;
    routes: { crews: { name: string } | null } | null;
    properties: { address_line1: string } | null;
  }[];
  empty.stopsTotal = visitRows.length;
  empty.stopsDone = visitRows.filter((visit) => visit.status === "completed").length;
  const byCrew = new Map<string, CrewRow>();
  for (const visit of visitRows) {
    const name = visit.routes?.crews?.name ?? "Unassigned";
    const row = byCrew.get(name) ?? { name, done: 0, total: 0, note: visit.properties?.address_line1 ?? "" };
    row.total += 1;
    if (visit.status === "completed") row.done += 1;
    if (!row.note && visit.properties?.address_line1) row.note = visit.properties.address_line1;
    byCrew.set(name, row);
  }
  empty.crews = [...byCrew.values()];

  const attention: AttentionItem[] = [];
  for (const lead of leads.data ?? []) {
    attention.push({
      id: lead.id,
      href: `/leads/${lead.id}`,
      title: lead.status === "new" ? `New request · ${lead.contact_name}` : `Follow up · ${lead.contact_name}`,
      detail: lead.address_typed,
      action: "Open",
    });
  }
  for (const quote of open.filter((row) => row.site_check_status === "requested").slice(0, 3)) {
    attention.push({
      id: quote.id,
      href: `/quotes/${quote.id}`,
      title: `Final price requested · ${quote.accounts?.name ?? quote.title}`,
      detail: quote.properties?.address_line1 ?? quote.title,
      action: "Review",
    });
  }
  empty.attention = attention.slice(0, 6);
  empty.motion = open.slice(0, 6).map((quote) => ({
    id: quote.id,
    number: quote.number,
    customer: quote.accounts?.name ?? "Account",
    work: quote.title,
    place: quote.properties?.address_line1 ?? "",
    status: quote.status,
    siteCheck: quote.site_check_status === "requested" || quote.site_check_status === "scheduled",
    total: totalOf(quote),
    updated: new Date(quote.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
  empty.error = error;
  return empty;
}
