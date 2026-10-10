import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import type { ConnectStatus } from "@/lib/stripe/connect";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "@/app/q/[token]/heading-font";
import { BrandingForm } from "./branding-form";
import { OrgSettingsForm } from "./org-settings-form";
import { StripeConnectCard } from "./stripe-connect-card";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireOrg();
  const { tab } = await searchParams;
  const supabase = await createClient();
  const { data: org, error } = await supabase.from("orgs").select("*").eq("id", session.orgId).maybeSingle();
  if (error) {
    return (
      <>
        <PageHeader title="Company settings" description="Profile, branding, and payments" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load settings</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!org) notFound();
  const canEdit = session.orgRole === "owner" || session.orgRole === "admin";
  const isOwner = session.orgRole === "owner";

  let connectStatus: ConnectStatus = "not_connected";
  if (session.orgRole === "owner" || session.orgRole === "admin") {
    const { data: connect } = await supabase
      .from("org_stripe_connect")
      .select("status")
      .eq("org_id", session.orgId)
      .maybeSingle();
    if (connect?.status) connectStatus = connect.status;
  } else {
    const { data: ready } = await supabase.rpc("org_payments_ready");
    connectStatus = ready ? "ready" : "not_connected";
  }

  return (
    <div className={headingSturdy.variable}>
      <PageHeader title="Settings" description="Company profile and defaults" />
      <div className="page-pad">
        <OrgSettingsForm
          org={org}
          canEdit={canEdit}
          tab={tab}
          branding={<BrandingForm org={org} canEdit={canEdit} />}
          payments={<StripeConnectCard isOwner={isOwner} status={connectStatus} />}
        />
      </div>
    </div>
  );
}
