import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import { canEditLeads, canViewLeads, leadDisplayName, type LeadActivity, type LeadRequest } from "@/lib/leads/detail";
import { loadPossibleMatchesForLead } from "@/lib/leads/match-candidates";
import { createClient } from "@/lib/supabase/server";
import { LeadDetail } from "./lead-detail";
import { LeadTaskList } from "./lead-task-list";
import type { LeadTaskRecord } from "@/lib/leads/tasks";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  if (!canViewLeads(session.orgRole)) {
    return (
      <>
        <PageHeader title="Lead" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>Your role cannot view leads.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const db = leadsClient(supabase);

  const activityQuery = db
    .from("lead_activities")
    .select("id, org_id, lead_request_id, kind, summary, meta, actor_id, occurred_at")
    .eq("lead_request_id", id)
    .eq("org_id", session.orgId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  const taskQuery = db
    .from("lead_tasks")
    .select("id, title, due_on, completed_at")
    .eq("lead_request_id", id)
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: true });
  const [leadResult, activityResult, taskResult, membersResult] = await Promise.all([
    db.from("lead_requests").select("*").eq("id", id).eq("org_id", session.orgId).maybeSingle(),
    Promise.resolve(activityQuery) as Promise<{ data: unknown; error: { message: string } | null }>,
    Promise.resolve(taskQuery) as Promise<{ data: unknown; error: { message: string } | null }>,
    supabase
      .from("memberships")
      .select("user_id, role, profiles(full_name)")
      .eq("org_id", session.orgId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "sales", "dispatcher"]),
  ]);
  const { data: lead, error: leadError } = leadResult;
  const { data: activities, error: activityError } = activityResult;
  const { data: members, error: membersError } = membersResult;
  const { data: taskRows, error: taskError } = taskResult;

  const loadError = leadError?.message ?? activityError?.message ?? membersError?.message ?? taskError?.message ?? null;
  if (loadError) {
    return (
      <>
        <PageHeader title="Lead" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this lead</AlertTitle>
            <AlertDescription>
              {loadError}. Lead tables come from L01 — merge that migration before this page can load live data.
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!lead) notFound();

  const typedLead = lead as LeadRequest & {
    phone?: string | null;
    email?: string | null;
    address_typed?: string | null;
    assignee_id?: string | null;
  };
  const typedActivities = (activities ?? []) as LeadActivity[];
  const people = (members ?? []).map((member) => {
    const profile = member.profiles as { full_name: string | null } | { full_name: string | null }[] | null;
    const row = Array.isArray(profile) ? profile[0] : profile;
    return {
      id: member.user_id,
      name: row?.full_name?.trim() || "Teammate",
    };
  });
  const assigneeId = typedLead.assigned_to ?? typedLead.assignee_id ?? null;
  const assigneeName = assigneeId
    ? (people.find((person) => person.id === assigneeId)?.name ?? "Teammate")
    : null;

  let possibleMatches: Awaited<ReturnType<typeof loadPossibleMatchesForLead>> = [];
  if (!typedLead.account_id) {
    try {
      possibleMatches = await loadPossibleMatchesForLead(supabase, session.orgId, {
        account_id: typedLead.account_id,
        phone: typedLead.phone ?? typedLead.contact_phone,
        email: typedLead.email ?? typedLead.contact_email,
        address_line1: typedLead.address_line1,
        address_typed: typedLead.address_typed,
        city: typedLead.city,
        postal_code: typedLead.postal_code,
      });
    } catch {
      possibleMatches = [];
    }
  }

  return (
    <>
      <PageHeader title={leadDisplayName(typedLead)} description="Lead detail" />
      <div className="page-body">
        <LeadTaskList
          leadId={typedLead.id}
          today={new Date().toISOString().slice(0, 10)}
          canEdit={canEditLeads(session.orgRole)}
          tasks={((taskRows ?? []) as { id: string; title: string; due_on: string | null; completed_at: string | null }[]).map(
            (row): LeadTaskRecord => ({
              id: row.id,
              title: row.title,
              dueOn: row.due_on,
              completedAt: row.completed_at,
            }),
          )}
        />
        <LeadDetail
          lead={{ ...typedLead, assigned_to: assigneeId }}
          activities={typedActivities}
          assigneeName={assigneeName}
          people={people}
          canEdit={canEditLeads(session.orgRole)}
          possibleMatches={possibleMatches}
        />
      </div>
    </>
  );
}
