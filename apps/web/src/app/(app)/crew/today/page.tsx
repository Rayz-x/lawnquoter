import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  CREW_TODAY_SELECTS,
  assembleStops,
  crewIdsFromMyCrews,
  crewNameLabel,
  orgLocalDate,
  parseMyCrews,
  type CrewStop,
  type CrewVisitRow,
} from "../today";

export const metadata: Metadata = { title: "Today" };

export default async function CrewTodayPage() {
  const session = await requireOrg();
  const supabase = await createClient();

  const { data: org, error: orgError } = await supabase
    .from("orgs")
    .select("timezone")
    .eq("id", session.orgId)
    .single();
  if (orgError || !org) return <CrewTodayState title="Couldn't load today's stops" />;

  const today = orgLocalDate(org.timezone);

  const { data: myCrews, error: crewError } = await supabase.rpc("my_crews");
  if (crewError) return <CrewTodayState title="Couldn't load today's stops" />;

  const crews = parseMyCrews(myCrews);
  const crewIds = crewIdsFromMyCrews(crews);
  const crewLabel = crewNameLabel(crews);
  if (crewIds.length === 0) {
    return (
      <CrewTodayState
        title="You're not on a crew."
        description="Ask the office to add you to a crew."
      />
    );
  }

  const { data: routes, error: routeError } = await supabase
    .from("routes")
    .select(CREW_TODAY_SELECTS.route)
    .eq("org_id", session.orgId)
    .eq("date", today)
    .neq("status", "draft")
    .in("crew_id", crewIds);
  if (routeError) return <CrewTodayState title="Couldn't load today's stops" header={crewLabel} />;

  const routeIds = (routes ?? []).map((route) => route.id);
  if (routeIds.length === 0) return <CrewTodayState title="No stops today" header={crewLabel} />;

  const { data: visits, error: visitError } = await supabase
    .from("visits")
    .select(CREW_TODAY_SELECTS.visit)
    .eq("org_id", session.orgId)
    .eq("scheduled_date", today)
    .in("route_id", routeIds);
  if (visitError) return <CrewTodayState title="Couldn't load today's stops" header={crewLabel} />;
  if (!visits || visits.length === 0) return <CrewTodayState title="No stops today" header={crewLabel} />;

  const propertyIds = [...new Set(visits.map((visit) => visit.property_id))];
  const visitIds = visits.map((visit) => visit.id);

  const [{ data: properties, error: propertyError }, { data: tasks, error: taskError }] = await Promise.all([
    supabase.from("properties").select(CREW_TODAY_SELECTS.property).eq("org_id", session.orgId).in("id", propertyIds),
    supabase.from("visit_tasks").select(CREW_TODAY_SELECTS.task).eq("org_id", session.orgId).in("visit_id", visitIds),
  ]);
  if (propertyError || taskError) return <CrewTodayState title="Couldn't load today's stops" header={crewLabel} />;

  const stops = assembleStops(visits satisfies CrewVisitRow[], properties ?? [], tasks ?? []);
  return <CrewTodayList stops={stops} crewLabel={crewLabel} />;
}

function CrewTodayList({ stops, crewLabel }: { stops: CrewStop[]; crewLabel: string }) {
  return (
    <>
      <PageHeader title="Today" description={crewLabel || "Your crew's stops"} />
      <div className="page-body">
        <ul className="flex flex-col gap-3">
          {stops.map((stop) => (
            <li key={stop.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium [overflow-wrap:anywhere]">{stop.address}</p>
                <Badge variant="outline">{stop.statusLabel}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">{stop.budgetLabel}</p>
              {stop.tasks.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {stop.tasks.map((label, index) => (
                    <li key={`${index}-${label}`}>{label}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function CrewTodayState({
  title,
  description,
  header,
}: {
  title: string;
  description?: string;
  header?: string;
}) {
  return (
    <>
      <PageHeader title="Today" description={header || "Your crew's stops"} />
      <div className="page-body">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{title}</EmptyTitle>
            {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          </EmptyHeader>
        </Empty>
      </div>
    </>
  );
}
