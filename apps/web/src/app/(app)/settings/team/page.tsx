import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { InviteMemberForm } from "./invite-member-form";
import { MemberRowActions } from "./member-row-actions";
import { RevokeInviteButton } from "./revoke-invite-button";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const [{ data: members }, { data: membership }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, status, invited_email, created_at, profiles(full_name, email)")
      .eq("org_id", session.orgId)
      .order("created_at"),
    supabase
      .from("memberships")
      .select("role")
      .eq("org_id", session.orgId)
      .eq("user_id", session.userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const { data: invites } = canManage
    ? await supabase
        .from("org_invites")
        .select("id, email, role, status, expires_at")
        .eq("org_id", session.orgId)
        .eq("status", "pending")
        .order("created_at")
    : { data: [] };

  return (
    <>
      <PageHeader title="Team" description="Everyone who can sign in to your workspace" />
      <div className="page-pad grid gap-4 lg:grid-cols-3">
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
                            isSelf={m.user_id === session.userId}
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
              <CardDescription>They get an email and join only after they accept.</CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm />
            </CardContent>
          </Card>
        ) : null}
        {canManage ? (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Pending invites</CardTitle>
              <CardDescription>No membership exists until the invite is accepted.</CardDescription>
            </CardHeader>
            <CardContent>
              {!invites || invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending invites.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell className="capitalize">{invite.role.replace("_", " ")}</TableCell>
                        <TableCell className="text-muted-foreground">{new Date(invite.expires_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <RevokeInviteButton inviteId={invite.id} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
