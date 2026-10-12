import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadSalesAnalytics } from "@/lib/analytics/load-sales-analytics";
import type { FunnelSlice } from "@/lib/analytics/sales-analytics";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { formatCents } from "@/lib/billing/review-queue";
import { formatMoney } from "@/lib/money";
import { addDays } from "@/lib/scheduling/recurrence";
import { isIsoDate, orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sales funnel" };

function FunnelTable({ rows }: { rows: FunnelSlice[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None in this range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Group</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead className="text-right">Quoted</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Quote rate</TableHead>
          <TableHead className="text-right">Close rate</TableHead>
          <TableHead className="text-right">Days to close</TableHead>
          <TableHead className="text-right">First response</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.key}</TableCell>
            <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
            <TableCell className="text-right tabular-nums">{row.quoted}</TableCell>
            <TableCell className="text-right tabular-nums">{row.accepted}</TableCell>
            <TableCell className="text-right tabular-nums">{row.quoteRate}%</TableCell>
            <TableCell className="text-right tabular-nums">{row.acceptRate}%</TableCell>
            <TableCell className="text-right tabular-nums">{row.medianDaysToClose ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.medianResponseMinutes == null ? "—" : `${row.medianResponseMinutes} min`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function SalesFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Sales funnel" description="Leads, quotes, and accepted work" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Sales reports stay in the office.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const params = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle();
  const today = orgToday(org?.timezone);
  const defaults = { from: addDays(today, -29), to: today };
  const from = params.from && isIsoDate(params.from) ? params.from : defaults.from;
  const to = params.to && isIsoDate(params.to) ? params.to : defaults.to;
  const rangeInvalid = from > to;
  const report = rangeInvalid
    ? null
    : await loadSalesAnalytics(supabase, session.orgId, `${from}T00:00:00.000Z`, `${addDays(to, 1)}T00:00:00.000Z`);

  return (
    <>
      <PageHeader title="Sales funnel" description="Leads to quoted to accepted, with pipeline value and lost reasons" />
      <div className="page-body space-y-8">
        <form className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">From</span>
            <Input type="date" name="from" defaultValue={from} className="w-auto" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">To</span>
            <Input type="date" name="to" defaultValue={to} className="w-auto" />
          </label>
          <Button type="submit" variant="outline">Apply</Button>
          <Button variant="ghost" render={<Link href="/leads/report" />}>Speed to lead</Button>
        </form>
        {rangeInvalid ? (
          <Alert variant="destructive">
            <AlertTitle>That date range is not valid</AlertTitle>
            <AlertDescription>Choose a From date on or before To.</AlertDescription>
          </Alert>
        ) : null}
        {report && !report.ok ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load the funnel</AlertTitle>
            <AlertDescription>{report.error}</AlertDescription>
          </Alert>
        ) : null}
        {report?.ok && !report.available ? (
          <Alert>
            <AlertTitle>Lead tables are not available yet</AlertTitle>
            <AlertDescription>The funnel appears once lead intake is stored for this company.</AlertDescription>
          </Alert>
        ) : null}
        {report?.ok && report.available ? (
          <>
            <p className="text-sm text-muted-foreground">
              {report.leadCount} leads. Median first response{" "}
              {report.medianResponseMinutes == null ? "not recorded" : `${report.medianResponseMinutes} min`}.
            </p>
            {(
              [
                ["By source", report.bySource],
                ["By rep", report.byRep],
                ["By service", report.byService],
              ] as const
            ).map(([title, rows]) => (
              <section key={title} className="space-y-2">
                <h2 className="font-heading text-lg">{title}</h2>
                <FunnelTable rows={rows} />
              </section>
            ))}
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Pipeline</h2>
              <p className="text-sm text-muted-foreground">
                {report.pipeline.quotes} open quotes worth {formatCents(report.pipeline.cents)}. The months
                below use each quote&apos;s expiration date, or the day it was created when it does not expire.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Open quotes</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.forecast.map((month) => (
                    <TableRow key={month.month}>
                      <TableCell>{month.month}</TableCell>
                      <TableCell className="text-right tabular-nums">{month.quotes}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(month.cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Lost reasons</h2>
              {report.losses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lost leads in this range.</p>
              ) : (
                <Table>
                  <TableBody>
                    {report.losses.map((loss) => (
                      <TableRow key={loss.reason}>
                        <TableCell>{loss.reason}</TableCell>
                        <TableCell className="text-right tabular-nums">{loss.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Widget funnel</h2>
              <Table>
                <TableBody>
                  {report.widget.map((stage) => (
                    <TableRow key={stage.stage}>
                      <TableCell>{stage.stage}</TableCell>
                      <TableCell className="text-right tabular-nums">{stage.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{stage.fromStart}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Estimated vs actual</h2>
              {report.variance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed job time in this range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Crew</TableHead>
                      <TableHead className="text-right">Estimated</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.variance.map((row) => (
                      <TableRow key={row.crew}>
                        <TableCell>{row.crew}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.estimatedHours} h</TableCell>
                        <TableCell className="text-right tabular-nums">{row.actualHours} h</TableCell>
                        <TableCell className="text-right tabular-nums">{row.varianceHours} h</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Margin</h2>
              <OutcomeTable rows={report.marginByService} empty="No invoiced labor in this range." />
              <OutcomeTable rows={report.marginByCrew} empty="No crew labor in this range." />
            </section>
            <section className="space-y-2">
              <h2 className="font-heading text-lg">Route density</h2>
              {report.density.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads or visits with a postal code.</p>
              ) : (
                <ul className="space-y-2">
                  {report.density.slice(0, 12).map((row) => (
                    <li key={row.postalCode} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-sm">
                      <span className="tabular-nums">{row.postalCode}</span>
                      <span
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.max(8, (row.count / (report.density[0]?.count || 1)) * 100)}%` }}
                      />
                      <span className="text-right tabular-nums">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}

function OutcomeTable({
  rows,
  empty,
}: {
  rows: { key: string; revenueCents: number; dollarsPerManHour: number | null; marginPercent: number | null }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Group</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">$/man-hour</TableHead>
          <TableHead className="text-right">Margin</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.key}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(row.revenueCents)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.dollarsPerManHour == null ? "—" : formatMoney(row.dollarsPerManHour, { cents: true })}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.marginPercent == null ? "—" : `${row.marginPercent}%`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
