import type { Metadata } from "next";
import Link from "next/link";
import { DISPATCH_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { parseDispatchView, scheduleHref, weekDates, type DispatchView } from "@/lib/scheduling/dispatch-view";
import { addDays } from "@/lib/scheduling/recurrence";
import { formatOfficeDay, isIsoDate, orgToday } from "@/lib/scheduling/office-date";
import {
  emptyAttentionTray,
  type AttentionTray,
  type AttentionVisit,
} from "@/lib/scheduling/attention-tray";
import { parseRevokePhoneResult, type RevokedUnsyncedVisit } from "@/lib/scheduling/phone-revoke";
import { boardPhonesForCrew } from "@/lib/scheduling/phone-sync";
import { createClient } from "@/lib/supabase/server";
import { isCrewStatus, type CrewStatus } from "@/lib/scheduling/crew-status";
import { isWeatherAction, isWeatherCondition, type WeatherRule } from "@/lib/scheduling/weather-rules";
import { DayBoard, type BoardColumn, type BoardVisit, type PhoneSync } from "./day-board";
import { DispatchGrid, type GridVisit } from "./dispatch-grid";
import { WeatherCard } from "./weather-card";

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
    seasonal_warn: row.seasonal_warn === true,
    enhancement_id: asString(row.enhancement_id),
    same_day_approved_until: asString(row.same_day_approved_until),
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

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; crew?: string }>;
}) {
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

  const { date: requested, view: requestedView, crew: requestedCrew } = await searchParams;
  const view: DispatchView = parseDispatchView(requestedView);
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("orgs")
    .select("timezone, settings")
    .eq("id", session.orgId)
    .maybeSingle();
  const today = orgToday(org?.timezone);
  const saturdayWorkday =
    org?.settings != null &&
    typeof org.settings === "object" &&
    !Array.isArray(org.settings) &&
    (org.settings as { saturday_workday?: unknown }).saturday_workday === true;
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
  const [
    { data: crews, error: crewsError },
    { data: routes, error: routesError },
    { data: visits, error: visitsError },
    { data: trayData, error: trayError },
    { data: memberRows, error: memberError },
    { data: phoneRows, error: phoneError },
    { data: revokeRows, error: revokeError },
    { data: ruleRows, error: ruleError },
    { data: statusRows, error: statusError },
  ] = await Promise.all([
      supabase.from("crews").select("id, name, active").eq("org_id", session.orgId).order("name"),
      supabase.from("routes").select("id, crew_id, status, revision").eq("org_id", session.orgId).eq("date", date),
      supabase.from("visits").select(visitSelect).eq("org_id", session.orgId).eq("scheduled_date", date).order("sort"),
      supabase.rpc("office_attention_tray", { p_as_of: today }),
      supabase
        .from("crew_members")
        .select("crew_id, profile_id, profiles(full_name, email)")
        .eq("org_id", session.orgId),
      supabase
        .from("crew_phone_sync")
        .select("crew_id, profile_id, pack_version, last_synced_at, profiles(full_name, email)")
        .eq("org_id", session.orgId)
        .eq("route_date", date),
      supabase
        .from("crew_phone_revocations")
        .select("profile_id, revoked_at, unsynced_visits")
        .eq("org_id", session.orgId)
        .is("cleared_at", null),
      supabase.from("weather_skip_rules").select("condition, threshold, action, enabled").eq("org_id", session.orgId),
      supabase.from("crew_status").select("crew_id, state").eq("org_id", session.orgId),
    ]);
  const error =
    crewsError?.message ??
    routesError?.message ??
    visitsError?.message ??
    trayError?.message ??
    memberError?.message ??
    phoneError?.message ??
    revokeError?.message ??
    ruleError?.message ??
    statusError?.message ??
    null;
  const tray = parseAttentionTray(trayData, today);
  const weatherRules: WeatherRule[] = (ruleRows ?? []).flatMap((row) =>
    isWeatherCondition(row.condition) && isWeatherAction(row.action)
      ? [{ condition: row.condition, threshold: row.threshold, action: row.action, enabled: row.enabled }]
      : [],
  );
  const routeByCrew = new Map((routes ?? []).map((route) => [route.crew_id, route]));
  const routeIds = new Set((routes ?? []).map((route) => route.id));
  const visibleCrews = (crews ?? []).filter((crew) => crew.active || routeByCrew.has(crew.id));
  const span = weekDates(date);
  const selectedCrew = visibleCrews.some((crew) => crew.id === requestedCrew)
    ? requestedCrew!
    : (visibleCrews[0]?.id ?? null);
  let gridError: string | null = null;
  let gridVisits: GridVisit[] = [];
  if (view !== "day") {
    const gridSelect =
      "id, route_id, scheduled_date, status, jobs(title), properties(accounts(name))";
    const [{ data: weekVisits, error: weekVisitError }, { data: weekRoutes, error: weekRouteError }] =
      await Promise.all([
        supabase
          .from("visits")
          .select(gridSelect)
          .eq("org_id", session.orgId)
          .gte("scheduled_date", span[0]!)
          .lte("scheduled_date", span[6]!),
        supabase
          .from("routes")
          .select("id, crew_id")
          .eq("org_id", session.orgId)
          .gte("date", span[0]!)
          .lte("date", span[6]!),
      ]);
    gridError = weekVisitError?.message ?? weekRouteError?.message ?? null;
    const crewByRoute = new Map((weekRoutes ?? []).map((route) => [route.id, route.crew_id]));
    gridVisits = (weekVisits ?? []).flatMap((visit) => {
      if (!visit.scheduled_date) return [];
      const property = one(visit.properties);
      const account = property ? one(property.accounts) : null;
      return [
        {
          id: visit.id,
          title: one(visit.jobs)?.title ?? "Visit",
          customer: account?.name ?? "Account",
          status: visit.status,
          crewId: visit.route_id ? (crewByRoute.get(visit.route_id) ?? null) : null,
          date: visit.scheduled_date,
        },
      ];
    });
  }
  const gridCrews =
    view === "crew"
      ? visibleCrews.filter((crew) => crew.id === selectedCrew).map((crew) => ({ id: crew.id, name: crew.name }))
      : visibleCrews.map((crew) => ({ id: crew.id, name: crew.name }));

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

  const membersByCrew = new Map<string, { profileId: string; name: string }[]>();
  for (const row of memberRows ?? []) {
    const profile = one(row.profiles);
    const member = {
      profileId: row.profile_id,
      name: profile?.full_name?.trim() || profile?.email?.trim() || "Phone",
    };
    const list = membersByCrew.get(row.crew_id) ?? [];
    list.push(member);
    membersByCrew.set(row.crew_id, list);
  }
  for (const [crewId, members] of membersByCrew) {
    members.sort((a, b) => a.name.localeCompare(b.name) || a.profileId.localeCompare(b.profileId));
    membersByCrew.set(crewId, members);
  }

  const syncByCrew = new Map<string, Map<string, { packVersion: number; lastSyncedAt: string }>>();
  for (const row of phoneRows ?? []) {
    const byProfile = syncByCrew.get(row.crew_id) ?? new Map();
    byProfile.set(row.profile_id, {
      packVersion: row.pack_version,
      lastSyncedAt: row.last_synced_at,
    });
    syncByCrew.set(row.crew_id, byProfile);
  }

  const revokeByProfile = new Map<string, { revokedAt: string; unsynced: RevokedUnsyncedVisit[] }>();
  for (const row of revokeRows ?? []) {
    const parsed = parseRevokePhoneResult({
      profile_id: row.profile_id,
      revoked_at: row.revoked_at,
      unsynced_visits: row.unsynced_visits,
    });
    if (!parsed) continue;
    revokeByProfile.set(parsed.profileId, {
      revokedAt: parsed.revokedAt,
      unsynced: parsed.unsynced,
    });
  }

  const statusByCrew = new Map<string, CrewStatus>();
  for (const row of statusRows ?? []) {
    if (isCrewStatus(row.state)) statusByCrew.set(row.crew_id, row.state);
  }

  const columns: BoardColumn[] = visibleCrews.map((crew) => {
    const route = routeByCrew.get(crew.id);
    const phones: PhoneSync[] = boardPhonesForCrew({
      members: membersByCrew.get(crew.id) ?? [],
      syncByProfile: syncByCrew.get(crew.id) ?? new Map(),
      revokeByProfile,
    });
    return {
      crewId: crew.id,
      crewName: crew.name,
      routeId: route?.id ?? null,
      routeStatus: route?.status ?? null,
      routeVersion: route?.revision ?? null,
      phones,
      visits: route ? (visitsByRoute.get(route.id) ?? []) : [],
      presence: statusByCrew.get(crew.id) ?? null,
    };
  });

  const step = view === "day" ? 1 : 7;
  const previous = addDays(date, -step);
  const next = addDays(date, step);
  const loadError = error ?? gridError;
  const views = [
    ["day", "Day"],
    ["week", "Week"],
    ["crew", "Crew"],
  ] as const;

  return (
    <>
      <PageHeader
        title={view === "day" ? formatOfficeDay(date) : "Schedule"}
        description={
          view === "day"
            ? canWrite
              ? "Assign visits, set the stop order, then publish."
              : "Office view. Dispatch assigns and publishes."
            : canWrite
              ? "Drag a scheduled stop onto another day or crew."
              : "Office view of the week."
        }
        actions={
          <>
            <Button variant="outline" render={<Link href={scheduleHref(previous, view, selectedCrew)} />}>
              {view === "day" ? "Previous day" : "Previous week"}
            </Button>
            <Button variant="outline" render={<Link href={scheduleHref(next, view, selectedCrew)} />}>
              {view === "day" ? "Next day" : "Next week"}
            </Button>
            {date !== today ? (
              <Button variant="outline" render={<Link href={scheduleHref(today, view, selectedCrew)} />}>
                Today
              </Button>
            ) : null}
          </>
        }
      />
      <div className="page-body">
        <div className="flex flex-wrap items-center gap-2">
          {views.map(([value, label]) => (
            <Button
              key={value}
              variant={view === value ? "default" : "outline"}
              render={<Link href={scheduleHref(date, value, selectedCrew)} />}
            >
              {label}
            </Button>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/schedule">
          <label htmlFor="schedule-date" className="text-sm text-muted-foreground">
            {view === "day" ? "Day" : "Starting"}
          </label>
          <Input id="schedule-date" type="date" name="date" defaultValue={date} required className="w-auto" />
          {view !== "day" ? <input type="hidden" name="view" value={view} /> : null}
          {view === "crew" && selectedCrew ? <input type="hidden" name="crew" value={selectedCrew} /> : null}
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
        {view === "crew" && visibleCrews.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {visibleCrews.map((crew) => (
              <Button
                key={crew.id}
                size="sm"
                variant={crew.id === selectedCrew ? "default" : "outline"}
                render={<Link href={scheduleHref(date, "crew", crew.id)} />}
              >
                {crew.name}
              </Button>
            ))}
          </div>
        ) : null}
        {canWrite ? <WeatherCard date={date} rules={weatherRules} /> : null}
        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load this schedule</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : view === "day" ? (
          <DayBoard
            date={date}
            canWrite={canWrite}
            timeZone={org?.timezone ?? "UTC"}
            saturdayWorkday={saturdayWorkday}
            tray={tray}
            columns={columns}
          />
        ) : (
          <DispatchGrid dates={span} crews={gridCrews} visits={gridVisits} canWrite={canWrite} />
        )}
      </div>
    </>
  );
}
