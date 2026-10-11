import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import { canEditLeads, canViewLeads, leadDisplayName, type LeadActivity, type LeadRequest } from "@/lib/leads/detail";
import { loadBannerMatchCandidates } from "@/lib/leads/match-sources";
import { createClient } from "@/lib/supabase/server";
import { LeadDetail } from "./lead-detail";

export const metadata: Metadata = { title: "Lead" };

type LeadRow = LeadRequest & {
  phone?: string | null;
  email?: string | null;
  assignee_id?: string | null;
  geocode_raw?: Record<string, unknown> | null;
};

function asLeadRequest(row: LeadRow): LeadRequest {
  return {
    ...row,
    contact_email: row.contact_email ?? row.email ?? null,
    contact_phone: row.contact_phone ?? row.phone ?? null,
    assigned_to: row.assigned_to ?? row.assignee_id ?? null,
  };
}

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
  const [leadResult, activityResult, membersResult] = await Promise.all([
    db.from("lead_requests").select("*").eq("id", id).eq("org_id", session.orgId).maybeSingle(),
    Promise.resolve(activityQuery) as Promise<{ data: unknown; error: { message: string } | null }>,
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

  const loadError = leadError?.message ?? activityError?.message ?? membersError?.message ?? null;
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

  const rawLead = lead as LeadRow;
  const typedLead = asLeadRequest(rawLead);
  const typedActivities = (activities ?? []) as LeadActivity[];
  const dismissedAccountIds = new Set(
    typedActivities
      .filter((activity) => activity.kind === "lead.match_dismissed")
      .map((activity) => {
        const accountId = activity.meta?.account_id;
        return typeof accountId === "string" ? accountId : null;
      })
      .filter((accountId): accountId is string => Boolean(accountId)),
  );

  let matchCandidates = await loadBannerMatchCandidates(supabase, {
    id: typedLead.id,
    org_id: typedLead.org_id,
    phone: typedLead.contact_phone,
    email: typedLead.contact_email,
    address_line1: typedLead.address_line1,
    city: typedLead.city,
    region: typedLead.region,
    postal_code: typedLead.postal_code,
    account_id: typedLead.account_id ?? null,
    property_id: typedLead.property_id ?? null,
    geocode_raw: rawLead.geocode_raw ?? null,
  });
  matchCandidates = matchCandidates.filter((candidate) => !dismissedAccountIds.has(candidate.accountId));

  const people = (members ?? []).map((member) => {
    const profile = member.profiles as { full_name: string | null } | { full_name: string | null }[] | null;
    const row = Array.isArray(profile) ? profile[0] : profile;
    return {
      id: member.user_id,
      name: row?.full_name?.trim() || "Teammate",
    };
  });
  const assigneeName = typedLead.assigned_to
    ? (people.find((person) => person.id === typedLead.assigned_to)?.name ?? "Teammate")
    : null;

  return (
    <>
      <PageHeader title={leadDisplayName(typedLead)} description="Lead detail" />
      <div className="page-body">
        <LeadDetail
          lead={typedLead}
          activities={typedActivities}
          assigneeName={assigneeName}
          people={people}
          canEdit={canEditLeads(session.orgRole)}
          matchCandidates={matchCandidates}
        />
      </div>
    </>
  );
}
