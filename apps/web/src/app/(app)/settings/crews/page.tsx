import type { Metadata } from "next";
import { DISPATCH_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AddCrewMemberForm, CreateCrewForm, SetCrewLeadForm } from "./crew-forms";

export const metadata: Metadata = { title: "Crews" };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function CrewsPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, DISPATCH_ROLES)) {
    return (
      <>
        <PageHeader title="Crews" description="Trucks that run a day of visits" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Dispatchers only</AlertTitle>
            <AlertDescription>Owners, admins, and dispatchers create crews and add members.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: crews, error: crewsError }, { data: members, error: membersError }, { data: people, error: peopleError }] =
    await Promise.all([
      supabase.from("crews").select("id, name, active, default_lead_id, profiles(full_name)").eq("org_id", session.orgId).order("name"),
      supabase.from("crew_members").select("id, crew_id, profile_id, profiles(full_name)").eq("org_id", session.orgId),
      supabase
        .from("memberships")
        .select("user_id, role, profiles(full_name)")
        .eq("org_id", session.orgId)
        .eq("status", "active")
        .in("role", ["crew", "crew_lead"])
        .order("created_at"),
    ]);
  const error = crewsError?.message ?? membersError?.message ?? peopleError?.message ?? null;
  const roleByProfile = new Map((people ?? []).flatMap((person) => (person.user_id ? [[person.user_id, person.role] as const] : [])));
  const roster = (crews ?? []).map((crew) => {
    const crewMembers = (members ?? []).filter((member) => member.crew_id === crew.id);
    return {
      id: crew.id,
      name: crew.name,
      active: crew.active,
      defaultLeadId: crew.default_lead_id,
      leadName: one(crew.profiles)?.full_name?.trim() || null,
      memberIds: crewMembers.map((member) => member.profile_id),
      members: crewMembers.map((member) => ({
        id: member.id,
        profileId: member.profile_id,
        name: one(member.profiles)?.full_name?.trim() || "Teammate",
        role: roleByProfile.get(member.profile_id) ?? "crew",
      })),
    };
  });
  const crewNameByProfile = new Map<string, string>();
  for (const crew of roster) {
    for (const profileId of crew.memberIds) crewNameByProfile.set(profileId, crew.name);
  }
  const teammates = (people ?? []).flatMap((person) => {
    if (!person.user_id) return [];
    return [
      {
        id: person.user_id,
        name: one(person.profiles)?.full_name?.trim() || "Teammate",
        role: person.role,
        crewName: crewNameByProfile.get(person.user_id) ?? null,
      },
    ];
  });

  return (
    <>
      <PageHeader title="Crews" description="Trucks that run a day of visits" />
      <div className="page-body grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load crews</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : roster.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No crews yet</EmptyTitle>
                <EmptyDescription>Create a crew, then add the people who ride on that truck.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            roster.map((crew) => (
              <Card key={crew.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    {crew.name}
                    <Badge variant={crew.active ? "secondary" : "outline"}>{crew.active ? "Active" : "Inactive"}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {crew.leadName ? `Lead: ${crew.leadName}` : "No crew lead yet"}
                    {crew.members.length === 0 ? " · No members yet" : ` · ${crew.members.length} members`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {crew.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Add a crew or crew lead from the form.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {crew.members.map((member) => (
                        <li key={member.id}>
                          {member.name}
                          <span className="text-muted-foreground">
                            {" "}
                            · {member.role === "crew_lead" ? "Crew lead" : "Crew"}
                            {member.profileId === crew.defaultLeadId ? " · Lead" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <SetCrewLeadForm
                    crewId={crew.id}
                    currentLeadId={crew.defaultLeadId}
                    leads={crew.members.flatMap((member) =>
                      member.role === "crew_lead" ? [{ id: member.profileId, name: member.name }] : [],
                    )}
                  />
                </CardContent>
              </Card>
            ))
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>New crew</CardTitle>
              <CardDescription>One crew is one truck for the day.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateCrewForm />
            </CardContent>
          </Card>
          {roster.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Add a member</CardTitle>
                <CardDescription>Crew and crew lead only. A person can ride on one crew.</CardDescription>
              </CardHeader>
              <CardContent>
                <AddCrewMemberForm
                  crews={roster.map((crew) => ({ id: crew.id, name: crew.name, memberIds: crew.memberIds }))}
                  people={teammates}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
