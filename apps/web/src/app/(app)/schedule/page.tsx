import type { Metadata } from "next";
import Link from "next/link";
import { DISPATCH_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { addDays } from "@/lib/scheduling/recurrence";
import { formatOfficeDay, isIsoDate, orgToday } from "@/lib/scheduling/office-date";
import {
  emptyAttentionTray,
  type AttentionTray,
  type AttentionVisit,
} from "@/lib/scheduling/attention-tray";
import { createClient } from "@/lib/supabase/server";
import { DayBoard, type BoardColumn, type BoardVisit } from "./day-board";

export const metadata: Metadata = { title: "Schedule" };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseAttentionVisit(item: unknown): AttentionVisit | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.status !== "string") {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    scheduled_date: asString(row.scheduled_date),
    account_name: asString(row.account_name),
    address_line1: asString(row.address_line1),
    city: asString(row.city),
    budget_minutes: asNumber(row.budget_minutes),
    reason: asString(row.reason),
    property_id: asString(row.property_id),
  };
}

function parseAttentionTray(value: unknown, asOf: string): AttentionTray {
  if (!value || typeof value !== "object") return emptyAttentionTray(asOf);
  const body = value as Partial<AttentionTray> & { counts?: Partial<Record<string, unknown>> };
  const list = (items: unknown): AttentionVisit[] =>
    Array.isArray(items) ? items.flatMap((item) => {
      const visit = parseAttentionVisit(item);
      return visit ? [visit] : [];
    }) : [];
  const unassigned = list(body.unassigned);
  const overdue = list(body.overdue);
  const needs_reschedule = list(body.needs_reschedule);
  const flags = list(body.flags);
  const count = (key: keyof AttentionTray["counts"], fallback: number) => {
    const raw = body.counts?.[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  };
  return {
    as_of: typeof body.as_of === "string" ? body.as_of : asOf,
    counts: {
      unassigned: count("unassigned", unassigned.length),
      overdue: count("overdue", overdue.length),
      needs_reschedule: count("needs_reschedule", needs_reschedule.length),
      flags: count("flags", flags.length),
    },
    unassigned,
    overdue,
    needs_reschedule,
    flags,
  };
}

function windowLabel(start: string | null, end: string | null): string | null {
  const open = start?.slice(0, 5);
  const close = end?.slice(0, 5);
  if (open && close) return `${open}–${close}`;
  return open ?? null;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Schedule" description="Dispatch a day by crew" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>The dispatch board is for the office. Crews open their day in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const { date: requested } = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle();
  const today = orgToday(org?.timezone);
  if (requested && !isIsoDate(requested)) {
    return (
      <>
        <PageHeader title="Schedule" description="Dispatch a day by crew" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>That date is not valid</AlertTitle>
            <AlertDescription>Use a real calendar day, formatted YYYY-MM-DD.</AlertDescription>
          </Alert>
          <Button variant="outline" render={<Link href="/schedule" />}>
            Back to today
          </Button>
        </div>
      </>
    );
  }

  const date = requested && isIsoDate(requested) ? requested : today;
  const canWrite = hasRole(session.orgRole, DISPATCH_ROLES);
  const visitSelect =
    "id, route_id, scheduled_date, sort, status, budget_minutes, window_start, window_end, jobs(title), properties(formatted_address, address_line1, city, accounts(name))";
  const [{ data: crews, error: crewsError }, { data: routes, error: routesError }, { data: visits, error: visitsError }, { data: trayData, error: trayError }] =
    await Promise.all([
      supabase.from("crews").select("id, name, active").eq("org_id", session.orgId).order("name"),
      supabase.from("routes").select("id, crew_id, status").eq("org_id", session.orgId).eq("date", date),
      supabase.from("visits").select(visitSelect).eq("org_id", session.orgId).eq("scheduled_date", date).order("sort"),
      supabase.rpc("office_attention_tray", { p_as_of: today }),
    ]);
  const error = crewsError?.message ?? routesError?.message ?? visitsError?.message ?? trayError?.message ?? null;
  const tray = parseAttentionTray(trayData, today);
  const routeByCrew = new Map((routes ?? []).map((route) => [route.crew_id, route]));
  const routeIds = new Set((routes ?? []).map((route) => route.id));
  const visibleCrews = (crews ?? []).filter((crew) => crew.active || routeByCrew.has(crew.id));

  const toVisit = (visit: NonNullable<typeof visits>[number]): BoardVisit => {
    const property = one(visit.properties);
    const account = property ? one(property.accounts) : null;
    return {
      id: visit.id,
      title: one(visit.jobs)?.title ?? "Visit",
      customer: account?.name ?? "Account",
      address:
        property?.formatted_address ||
        [property?.address_line1, property?.city].filter(Boolean).join(", ") ||
        "Address unavailable",
      status: visit.status,
      scheduledDate: visit.scheduled_date,
      overdue: visit.scheduled_date != null && visit.scheduled_date < today,
      budgetMinutes: visit.budget_minutes,
      windowLabel: windowLabel(visit.window_start, visit.window_end),
    };
  };

  const visitsByRoute = new Map<string, BoardVisit[]>();
  for (const visit of visits ?? []) {
    if (!visit.route_id || !routeIds.has(visit.route_id)) continue;
    const card = toVisit(visit);
    const list = visitsByRoute.get(visit.route_id) ?? [];
    list.push(card);
    visitsByRoute.set(visit.route_id, list);
  }

  const columns: BoardColumn[] = visibleCrews.map((crew) => {
    const route = routeByCrew.get(crew.id);
    return {
      crewId: crew.id,
      crewName: crew.name,
      routeId: route?.id ?? null,
      routeStatus: route?.status ?? null,
      visits: route ? (visitsByRoute.get(route.id) ?? []) : [],
    };
  });

  const previous = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <>
      <PageHeader
        title={formatOfficeDay(date)}
        description={canWrite ? "Assign visits, set the stop order, then publish." : "Office view. Dispatch assigns and publishes."}
        actions={
          <>
            <Button variant="outline" render={<Link href={`/schedule?date=${previous}`} />}>
              Previous day
            </Button>
            <Button variant="outline" render={<Link href={`/schedule?date=${next}`} />}>
              Next day
            </Button>
            {date !== today ? (
              <Button variant="outline" render={<Link href="/schedule" />}>
                Today
              </Button>
            ) : null}
          </>
        }
      />
      <div className="page-body">
        <form className="flex flex-wrap items-center gap-2" action="/schedule">
          <label htmlFor="schedule-date" className="text-sm text-muted-foreground">
            Day
          </label>
          <Input id="schedule-date" type="date" name="date" defaultValue={date} required className="w-auto" />
          <Button type="submit" variant="outline">
            Show day
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load this day</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <DayBoard date={date} canWrite={canWrite} tray={tray} columns={columns} />
        )}
      </div>
    </>
  );
}
