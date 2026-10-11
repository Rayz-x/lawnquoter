import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { loadSpeedToLeadReport } from "@/lib/leads/load-speed-to-lead-report";
import { formatConversionRate, formatMedianMinutes } from "@/lib/leads/speed-to-lead-report";
import { addDays } from "@/lib/scheduling/recurrence";
import { isIsoDate, orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lead sources" };

function defaultRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}

export default async function LeadSourceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Lead sources" description="Speed to lead and conversion by source" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>
              Lead reports stay in the office. Crews open their day in the crew app.
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const params = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle();
  const today = orgToday(org?.timezone);
  const defaults = defaultRange(today);

  const from = params.from && isIsoDate(params.from) ? params.from : defaults.from;
  const to = params.to && isIsoDate(params.to) ? params.to : defaults.to;
  const rangeInvalid = from > to;

  const result = rangeInvalid
    ? null
    : await loadSpeedToLeadReport(supabase, session.orgId, `${from}T00:00:00.000Z`, `${addDays(to, 1)}T00:00:00.000Z`);

  return (
    <>
      <PageHeader title="Lead sources" description="Median first response and conversion by source" />
      <div className="page-body space-y-4">
        <form className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">From</span>
            <Input type="date" name="from" defaultValue={from} className="w-auto" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">To</span>
            <Input type="date" name="to" defaultValue={to} className="w-auto" />
          </label>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>

        {rangeInvalid ? (
          <Alert variant="destructive">
            <AlertTitle>That date range is not valid</AlertTitle>
            <AlertDescription>Choose a From date on or before To.</AlertDescription>
          </Alert>
        ) : null}

        {result && !result.ok ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load the report</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        ) : null}

        {result?.ok && !result.available ? (
          <Alert>
            <AlertTitle>Lead tables not available yet</AlertTitle>
            <AlertDescription>
              Speed-to-lead needs lead intake tables on this database. The report layout is ready; numbers
              appear once leads are stored with first contact times.
            </AlertDescription>
          </Alert>
        ) : null}

        {result?.ok && result.available && result.rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <BarChart3 className="size-8 text-muted-foreground" aria-hidden />
              <EmptyTitle>No leads in this range</EmptyTitle>
              <EmptyDescription>Try a wider date range, or check back after new leads arrive.</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" render={<Link href="/leads/report" />}>
              Reset to last 30 days
            </Button>
          </Empty>
        ) : null}

        {result?.ok && result.rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Contacted</TableHead>
                <TableHead className="text-right">Median response</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.source}>
                  <TableCell>{row.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.leadCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.contactedCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMedianMinutes(row.medianResponseMs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatConversionRate(row.conversionRate)}
                    <span className="ms-1 text-muted-foreground">
                      ({row.convertedCount}/{row.leadCount})
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </>
  );
}
