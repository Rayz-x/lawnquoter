import type { Metadata } from "next";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { groupCosting, type CostingInput, type CostingRow } from "@/lib/billing/job-costing";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Job costing" };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function money(cents: number): string {
  return formatMoney(cents / 100, { cents: true });
}

function hours(value: number): string {
  return value.toFixed(1);
}

function CostTable({ title, rows }: { title: string; rows: CostingRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing completed yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{title}</TableHead>
                <TableHead>Est. hours</TableHead>
                <TableHead>Actual hours</TableHead>
                <TableHead>Man-hours</TableHead>
                <TableHead>Est. cost</TableHead>
                <TableHead>Labor cost</TableHead>
                <TableHead>$ / man-hour</TableHead>
                <TableHead>Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{hours(row.estimatedHours)}</TableCell>
                  <TableCell>{hours(row.actualHours)}</TableCell>
                  <TableCell>{hours(row.manHours)}</TableCell>
                  <TableCell>{money(row.estimatedCostCents)}</TableCell>
                  <TableCell>{money(row.actualCostCents)}</TableCell>
                  <TableCell>{row.dollarsPerManHour == null ? "—" : formatMoney(row.dollarsPerManHour, { cents: true })}</TableCell>
                  <TableCell>{money(row.marginCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default async function JobCostingPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Job costing" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Job costing stays in the office.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const { data: visits, error } = await supabase
    .from("visits")
    .select(
      "id, crew_size, budget_minutes, routes(crews(name)), properties(accounts(name)), visit_tasks(label, quote_line_items(name, hours, cost, price))",
    )
    .eq("org_id", session.orgId)
    .eq("status", "completed")
    .order("scheduled_date", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <>
        <PageHeader title="Job costing" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load job costing</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const visitIds = (visits ?? []).map((visit) => visit.id);
  const [{ data: entries }, { data: rates }] = await Promise.all([
    visitIds.length
      ? supabase.from("time_entries").select("visit_id, kind, started_at, ended_at").eq("org_id", session.orgId).in("visit_id", visitIds)
      : Promise.resolve({ data: [] }),
    supabase.from("labor_rates").select("hourly_rate, burden_pct").eq("org_id", session.orgId).order("created_at").limit(1),
  ]);
  const rate = rates?.[0];
  const minutesByVisit = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (entry.kind !== "job" || !entry.visit_id || !entry.ended_at) continue;
    const minutes = Math.max(0, (new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 60000);
    minutesByVisit.set(entry.visit_id, (minutesByVisit.get(entry.visit_id) ?? 0) + minutes);
  }

  const inputs: CostingInput[] = (visits ?? []).map((visit) => {
    const tasks = visit.visit_tasks ?? [];
    const lines = tasks.map((task) => one(task.quote_line_items)).filter((line) => line != null);
    const estimatedHours = lines.reduce((sum, line) => sum + Number(line.hours ?? 0), 0) || (visit.budget_minutes ?? 0) / 60;
    const crew = one(one(visit.routes)?.crews)?.name ?? "Unassigned";
    const customer = one(one(visit.properties)?.accounts)?.name ?? "Customer";
    const service = lines[0]?.name || tasks[0]?.label || "Service";
    return {
      service,
      crew,
      customer,
      estimatedHours,
      estimatedCostCents: lines.reduce((sum, line) => sum + Math.round(Number(line.cost ?? 0) * 100), 0),
      actualMinutes: minutesByVisit.get(visit.id) ?? 0,
      crewSize: visit.crew_size ?? 1,
      revenueCents: lines.reduce((sum, line) => sum + Math.round(Number(line.price ?? 0) * 100), 0),
      hourlyRate: Number(rate?.hourly_rate ?? 0),
      burdenPct: Number(rate?.burden_pct ?? 0),
    };
  });

  return (
    <>
      <PageHeader title="Job costing" description="Estimated and actual hours, labor, and margin for completed visits." />
      <div className="page-body flex flex-col gap-4">
        <CostTable title="Service" rows={groupCosting(inputs, (row) => row.service)} />
        <CostTable title="Crew" rows={groupCosting(inputs, (row) => row.crew)} />
        <CostTable title="Customer" rows={groupCosting(inputs, (row) => row.customer)} />
      </div>
    </>
  );
}
