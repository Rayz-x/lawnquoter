import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireOrg();
  const supabase = await createClient();
  const [{ data: org }, { data: profile }] = await Promise.all([
    supabase.from("orgs").select("name").eq("id", session.orgId).single(),
    supabase.from("profiles").select("full_name").eq("id", session.userId).single(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        orgName={org?.name ?? "Your company"}
        userEmail={session.email}
        userName={profile?.full_name ?? null}
        role={session.orgRole}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
