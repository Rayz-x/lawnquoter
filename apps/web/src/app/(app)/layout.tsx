import type { ReactNode } from "react";
import { hasRole } from "@lawnquoter/shared";
import { OfficeShell } from "@/components/app-shell/office-shell";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireOrg();
  const supabase = await createClient();
  const office = hasRole(session.orgRole, OFFICE_ROLES);
  const [{ data: org }, { data: profile }, { data: memberships }, requestCount] = await Promise.all([
    supabase.from("orgs").select("name").eq("id", session.orgId).single(),
    supabase.from("profiles").select("full_name").eq("id", session.userId).single(),
    supabase.from("memberships").select("org_id, orgs(name)").eq("user_id", session.userId).eq("status", "active"),
    office
      ? supabase
          .from("lead_requests")
          .select("id", { count: "exact", head: true })
          .eq("org_id", session.orgId)
          .eq("status", "new")
      : Promise.resolve({ count: 0 }),
  ]);

  const orgs = (memberships ?? []).flatMap((row) => {
    const name = row.orgs?.name;
    return name ? [{ id: row.org_id, name }] : [];
  });

  return (
    <OfficeShell
      orgName={org?.name ?? "Your company"}
      orgs={orgs.length > 0 ? orgs : [{ id: session.orgId, name: org?.name ?? "Your company" }]}
      currentOrgId={session.orgId}
      userEmail={session.email}
      userName={profile?.full_name ?? null}
      role={session.orgRole}
      requestCount={requestCount.count ?? 0}
    >
      {children}
    </OfficeShell>
  );
}
