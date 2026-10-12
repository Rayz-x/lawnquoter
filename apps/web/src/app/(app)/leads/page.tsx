import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { LeadAgeBadge } from "@/lib/leads/age-badge-view";
import { formatLeadSource, LEAD_SOURCES, WEBSITE_FORM_SOURCE } from "@/lib/leads/lead-source";
import { PipelineBoard } from "@/lib/leads/pipeline-board";
import { pipelineColumns, toPipelineCards } from "@/lib/leads/pipeline";
import { leadDisplayName, listLeadRequests } from "@/lib/leads/queries";
import { responseTargetMinutes } from "@/lib/leads/response-target";
import { LEAD_STATUSES } from "@/lib/leads/types";
import { createClient } from "@/lib/supabase/server";
import { ManualLeadDialog } from "./manual-lead-dialog";

export const metadata: Metadata = { title: "Leads" };

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; assignee?: string; view?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Leads" description="Inbound requests waiting for a response" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Leads stay in the office. Crews see their route in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const { status, source, assignee, view } = await searchParams;
  const board = view === "board";
  const supabase = await createClient();
  const [{ data: org }, list, { data: members }] = await Promise.all([
    supabase.from("orgs").select("settings").eq("id", session.orgId).maybeSingle(),
    listLeadRequests(supabase, session.orgId, board ? { source, assignee } : { status, source, assignee }),
    supabase
      .from("memberships")
      .select("user_id, profiles(full_name)")
      .eq("org_id", session.orgId)
      .eq("status", "active")
      .order("created_at"),
  ]);

  const targetMinutes = responseTargetMinutes(org?.settings);
  const canAdd = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);
  const now = new Date();
  const openTasks = new Map<string, number>();
  if (board && list.ok) {
    const { data: taskRows } = await supabase
      .from("lead_tasks")
      .select("lead_request_id")
      .eq("org_id", session.orgId)
      .is("completed_at", null);
    for (const row of taskRows ?? []) {
      openTasks.set(row.lead_request_id, (openTasks.get(row.lead_request_id) ?? 0) + 1);
    }
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description={board ? "Pipeline by stage. Rotting means the lead has sat too long." : "Inbound requests waiting for a response"}
        actions={
          <div className="flex items-center gap-2">
            <Button variant={board ? "outline" : "secondary"} render={<Link href="/leads" />}>
              List
            </Button>
            <Button variant={board ? "secondary" : "outline"} render={<Link href="/leads?view=board" />}>
              Board
            </Button>
            {canAdd ? <ManualLeadDialog /> : null}
          </div>
        }
      />
      <div className="page-body">
        <form className="flex flex-wrap items-center gap-2">
          {board ? <input type="hidden" name="view" value="board" /> : (
            <NativeSelect name="status" defaultValue={status ?? ""} className="w-auto" aria-label="Status">
              <option value="">Active (hide spam)</option>
              <option value="all">All statuses</option>
              {LEAD_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {statusLabel(item)}
                </option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect name="source" defaultValue={source ?? ""} className="w-auto" aria-label="Source">
            <option value="">All sources</option>
            {[...LEAD_SOURCES, WEBSITE_FORM_SOURCE].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="assignee" defaultValue={assignee ?? ""} className="w-auto" aria-label="Assignee">
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {(members ?? []).map((member) => {
              const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
              const label = profile?.full_name?.trim() || "Teammate";
              return (
                <option key={member.user_id} value={member.user_id}>
                  {label}
                </option>
              );
            })}
          </NativeSelect>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>

        {list.ok === false ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load leads</AlertTitle>
            <AlertDescription>{list.error}</AlertDescription>
          </Alert>
        ) : board ? (
          <PipelineBoard
            columns={pipelineColumns(
              toPipelineCards(
                list.leads.map((lead) => ({ ...lead, open_tasks: openTasks.get(lead.id) ?? 0 })),
                now,
                targetMinutes,
              ),
            )}
          />
        ) : list.leads.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No leads yet</EmptyTitle>
              <EmptyDescription>
                {canAdd
                  ? "Add a phone lead, or wait for website form submissions."
                  : "No leads match these filters."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Next follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {leadDisplayName(lead)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[lead.phone, lead.email].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {statusLabel(lead.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatLeadSource(lead.source, lead.source_other) ?? "—"}</TableCell>
                  <TableCell>
                    <LeadAgeBadge createdAt={lead.created_at} targetMinutes={targetMinutes} now={now} />
                  </TableCell>
                  <TableCell>{lead.assignee_name ?? "Unassigned"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.next_follow_up_on
                      ? new Date(`${lead.next_follow_up_on}T12:00:00`).toLocaleDateString()
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
