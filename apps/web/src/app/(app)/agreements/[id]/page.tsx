import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { FactStrip } from "@/components/entry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { OFFICE_ROLES, QUOTE_CONVERT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { isSnowContract, parseSnowTiers, snowPushPrice } from "@/lib/agreements/snow-contract";
import { formatOfficeDay } from "@/lib/scheduling/office-date";
import { DEFAULT_SEASON } from "@/lib/scheduling/season";
import { createClient } from "@/lib/supabase/server";
import { AgreementLifecycleForm } from "./agreement-lifecycle-form";
import { EnhancementForm } from "./enhancement-form";
import { AgreementHoldForm } from "./agreement-hold-form";
import { AgreementScheduleForm } from "./agreement-schedule-form";
import { FixedRouteDayForm } from "./fixed-route-day-form";
import { SnowContractForm } from "./snow-contract-form";

export const metadata: Metadata = { title: "Agreement" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Agreement" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Agreements stay in the office. Crews see their route in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: agreement, error: agreementError }, { data: org }, { data: enhancements }] = await Promise.all([
    supabase
      .from("agreements")
      .select(
        "id, kind, frequency, status, start_date, end_date, preferred_dow, fixed_route_day, service_kind, snow_contract, trigger_depth_in, snow_price, snow_tiers, notes_office, quote_id, account_id, property_id, resume_on, season_start_month, season_start_day, season_end_month, season_end_day, accounts(name), properties(formatted_address, address_line1, city)",
      )
      .eq("id", id)
      .eq("org_id", session.orgId)
      .maybeSingle(),
    supabase
      .from("orgs")
      .select("season_start_month, season_start_day, season_end_month, season_end_day")
      .eq("id", session.orgId)
      .maybeSingle(),
    supabase.from("agreement_enhancements").select("id, title, quote_id").eq("agreement_id", id).order("created_at"),
  ]);

  if (agreementError) {
    return (
      <>
        <PageHeader title="Agreement" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this agreement</AlertTitle>
            <AlertDescription>{agreementError.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!agreement) notFound();

  const [{ data: jobs, error: jobsError }, { data: visits, error: visitsError }, { data: holds, error: holdsError }] =
    await Promise.all([
      supabase.from("jobs").select("id, title, status").eq("agreement_id", id).eq("org_id", session.orgId).order("created_at"),
      supabase
        .from("visits")
        .select(
          "id, scheduled_date, occurrence_date, status, budget_minutes, crew_size, sort, routes(status, crews(name)), visit_tasks(id, label, quantity_text, sort, done_at)",
        )
        .eq("agreement_id", id)
        .eq("org_id", session.orgId)
        .order("scheduled_date")
        .order("sort"),
      supabase
        .from("agreement_holds")
        .select("id, start_date, end_date, note")
        .eq("agreement_id", id)
        .eq("org_id", session.orgId)
        .order("start_date"),
    ]);

  const account = one(agreement.accounts);
  const property = one(agreement.properties);
  const address =
    property?.formatted_address ||
    [property?.address_line1, property?.city].filter(Boolean).join(", ") ||
    "Address unavailable";
  const canEditSchedule = agreement.status !== "ended" && hasRole(session.orgRole, QUOTE_CONVERT_ROLES);
  const canManageLifecycle = agreement.status !== "ended" && hasRole(session.orgRole, ["owner", "admin", "dispatcher"]);
  const recurring = agreement.kind === "recurring" && agreement.frequency != null && agreement.status === "active";
  const orgSeason = {
    startMonth: org?.season_start_month ?? DEFAULT_SEASON.startMonth,
    startDay: org?.season_start_day ?? DEFAULT_SEASON.startDay,
    endMonth: org?.season_end_month ?? DEFAULT_SEASON.endMonth,
    endDay: org?.season_end_day ?? DEFAULT_SEASON.endDay,
  };
  const visitsThrough =
    visits
      ?.filter((visit) => visit.status !== "cancelled" && visit.occurrence_date)
      .map((visit) => visit.occurrence_date as string)
      .sort()
      .at(-1) ?? null;
  const loadError = jobsError?.message ?? visitsError?.message ?? holdsError?.message ?? null;
  const weekday =
    agreement.preferred_dow != null && agreement.preferred_dow >= 0 && agreement.preferred_dow <= 6
      ? WEEKDAYS[agreement.preferred_dow]
      : null;
  const rawSnowContract = agreement.snow_contract ?? "";
  const snowContract = isSnowContract(rawSnowContract) ? rawSnowContract : null;
  const triggerDepth = agreement.trigger_depth_in == null ? null : Number(agreement.trigger_depth_in);
  const snowPrice = agreement.snow_price == null ? null : Number(agreement.snow_price);
  const sampleInches = triggerDepth == null ? null : triggerDepth + 1;
  const sampleSnow =
    snowContract && triggerDepth != null && snowPrice != null && sampleInches != null
      ? `${sampleInches} in of snow prices at $${snowPushPrice(
          {
            contract: snowContract,
            triggerDepthIn: triggerDepth,
            price: snowPrice,
            tiers: parseSnowTiers(agreement.snow_tiers),
          },
          sampleInches,
        )}`
      : null;

  return (
    <>
      <PageHeader
        title={account?.name ?? "Agreement"}
        description={address}
        actions={
          <>
            <Button variant="outline" render={<Link href={`/accounts/${agreement.account_id}`} />}>
              Account
            </Button>
            <Button variant="outline" render={<Link href={`/properties/${agreement.property_id}`} />}>
              Property
            </Button>
            {agreement.quote_id ? (
              <Button variant="outline" render={<Link href={`/quotes/${agreement.quote_id}`} />}>
                Source quote
              </Button>
            ) : null}
          </>
        }
      />
      <div className="page-body flex flex-col gap-4">
        {recurring ? (
          <FactStrip
            facts={[
              {
                label: "Next visits through",
                value: visitsThrough ? formatOfficeDay(visitsThrough) : "—",
                detail: visitsThrough ? undefined : "Fills about 10 weeks nightly",
              },
            ]}
          />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            {loadError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load jobs or visits</AlertTitle>
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Jobs</CardTitle>
                <CardDescription>Work held on this agreement.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {jobsError ? null : !jobs || jobs.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No job yet</EmptyTitle>
                      <EmptyDescription>Converting an accepted quote creates the job.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  jobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <span className="font-medium">{job.title}</span>
                      <Badge variant="outline" className="capitalize">
                        {label(job.status)}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Visits</CardTitle>
                <CardDescription>
                  {visits?.length ?? 0} scheduled. Budget is minutes on site, with an after photo required.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {visitsError ? null : !visits || visits.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No visits yet</EmptyTitle>
                      <EmptyDescription>
                        {recurring
                          ? "Visits roll forward nightly about 10 weeks ahead."
                          : "A one-time agreement gets its visit when the quote is converted."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  visits.map((visit) => {
                    const route = one(visit.routes);
                    const crew = route ? one(route.crews) : null;
                    const tasks = [...(visit.visit_tasks ?? [])].sort((a, b) => a.sort - b.sort);
                    return (
                      <div key={visit.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium tabular-nums">{visit.scheduled_date ?? "Unscheduled"}</div>
                          <Badge variant="outline" className="capitalize">
                            {label(visit.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {crew?.name ?? "Unassigned"}
                          {visit.budget_minutes != null ? ` · ${visit.budget_minutes} min` : ""}
                          {` · crew of ${visit.crew_size}`}
                        </p>
                        {tasks.length > 0 ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {tasks.map((task) => (
                              <li key={task.id} className="flex items-baseline justify-between gap-3">
                                <span>
                                  {task.label}
                                  {task.done_at ? " · done" : ""}
                                </span>
                                {task.quantity_text ? (
                                  <span className="text-xs text-muted-foreground">{task.quantity_text}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-muted-foreground">No tasks on this visit.</p>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {canEditSchedule ? (
                  <>
                    <AgreementScheduleForm
                      agreementId={agreement.id}
                      kind={agreement.kind}
                      frequency={agreement.frequency}
                      preferredDow={agreement.preferred_dow}
                      startDate={agreement.start_date}
                    />
                    <FixedRouteDayForm
                      agreementId={agreement.id}
                      fixed={agreement.fixed_route_day}
                      weekday={weekday}
                    />
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Kind</span>
                      <span className="capitalize">{label(agreement.kind)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Frequency</span>
                      <span className="capitalize">{label(agreement.frequency)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Apply from</span>
                      <span className="tabular-nums">{agreement.start_date}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Preferred day</span>
                      <span>{weekday ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Fixed route day</span>
                      <span>{agreement.fixed_route_day ? (weekday ?? "Locked") : "No"}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{label(agreement.status)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Ends</span>
                  <span className="tabular-nums">{agreement.end_date ?? "Open"}</span>
                </div>
                {agreement.service_kind ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Service</span>
                    <span className="capitalize">{label(agreement.service_kind)}</span>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Snow contract</CardTitle>
                <CardDescription>Per push, per inch, or a seasonal price. Below the trigger, a push is not billed.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {sampleSnow ? <p className="tabular-nums">{sampleSnow}</p> : null}
                {canEditSchedule ? (
                  <SnowContractForm
                    agreementId={agreement.id}
                    contract={agreement.snow_contract}
                    triggerDepthIn={agreement.trigger_depth_in}
                    price={agreement.snow_price}
                  />
                ) : (
                  <p className="text-muted-foreground">{agreement.snow_contract ? label(agreement.snow_contract) : "No snow contract"}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Season & status</CardTitle>
                <CardDescription>Mowing season, pause, and end.</CardDescription>
              </CardHeader>
              <CardContent>
                <AgreementLifecycleForm
                  agreementId={agreement.id}
                  status={agreement.status}
                  resumeOn={agreement.resume_on}
                  seasonStartMonth={agreement.season_start_month}
                  seasonStartDay={agreement.season_start_day}
                  seasonEndMonth={agreement.season_end_month}
                  seasonEndDay={agreement.season_end_day}
                  orgSeason={orgSeason}
                  canEditSeason={canEditSchedule}
                  canManageStatus={canManageLifecycle}
                />
              </CardContent>
            </Card>

            {recurring ? (
              <Card>
                <CardHeader>
                  <CardTitle>Vacation holds</CardTitle>
                  <CardDescription>Date ranges stay cancelled and are not made up.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  {holdsError ? null : !holds || holds.length === 0 ? (
                    <p className="text-muted-foreground">No holds yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {holds.map((hold) => (
                        <li key={hold.id} className="rounded-md border p-3">
                          <div className="font-medium tabular-nums">
                            {formatOfficeDay(hold.start_date)} – {formatOfficeDay(hold.end_date)}
                          </div>
                          {hold.note ? <p className="mt-1 text-muted-foreground">{hold.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canEditSchedule ? <AgreementHoldForm agreementId={agreement.id} /> : null}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Enhancements</CardTitle>
                <CardDescription>A proposal attached to this agreement.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {(enhancements ?? []).length === 0 ? <p className="text-muted-foreground">No enhancement proposals yet.</p> : null}
                {(enhancements ?? []).map((item) => (
                  <Link key={item.id} href={`/quotes/${item.quote_id}`} className="font-medium">
                    {item.title}
                  </Link>
                ))}
                {canEditSchedule ? <EnhancementForm agreementId={agreement.id} /> : null}
              </CardContent>
            </Card>

            {agreement.notes_office ? (
              <Card>
                <CardHeader>
                  <CardTitle>Office notes</CardTitle>
                </CardHeader>
                <CardContent className="text-sm whitespace-pre-wrap">{agreement.notes_office}</CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
