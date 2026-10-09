import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { InviteMemberForm } from "./invite-member-form";
import { MemberRowActions } from "./member-row-actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("memberships")
    .select("id, role, status, invited_email, created_at, profiles(full_name, email)")
    .eq("org_id", session.orgId)
    .order("created_at");

  const canManage = session.orgRole === "owner" || session.orgRole === "admin";

  return (
    <>
      <PageHeader title="Team" description="Everyone who can sign in to your workspace" />
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>No per-seat fees. Add your whole crew.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="w-0" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members ?? []).map((m) => {
                  const profile = m.profiles;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{profile?.full_name ?? m.invited_email ?? "Pending"}</span>
                          <span className="text-xs text-muted-foreground">{profile?.email ?? m.invited_email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{m.role.replace("_", " ")}</TableCell>
                      <TableCell>
                        <Badge variant={m.status === "active" ? "secondary" : "outline"}>{m.status}</Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <MemberRowActions
                            membershipId={m.id}
                            role={m.role}
                            status={m.status}
                            isSelf={false}
                            isOwner={m.role === "owner"}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite a teammate</CardTitle>
              <CardDescription>They get an email with a sign-in link.</CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
