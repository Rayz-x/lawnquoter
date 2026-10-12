import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import type { ConnectStatus } from "@/lib/stripe/connect";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "@/app/q/[token]/heading-font";
import { usageFromRpc } from "@/lib/billing/usage";
import { leadFormSlugFromOrg } from "@/lib/leads/embed-snippets";
import { BrandingForm } from "./branding-form";
import { LateFeeCard } from "./late-fee-card";
import { LeadConnectorsCard } from "./lead-connectors-card";
import { LeadFormEmbedCard } from "./lead-form-embed-card";
import { OrgSettingsForm } from "./org-settings-form";
import { StripeConnectCard } from "./stripe-connect-card";
import { UsageCard } from "./usage-card";
import { WisetackCard } from "./wisetack-card";

export const metadata: Metadata = { title: "Settings" };

function accountLast4(accountId: string | null | undefined) {
  if (!accountId || accountId.length < 4) return null;
  return accountId.slice(-4);
}

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
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const formSlug = leadFormSlugFromOrg(org);
  let usage: { imagerySessions: number; measurements: number } | null = null;
  if (canEdit) {
    const { data, error: usageError } = await supabase.rpc("usage_totals");
    usage = usageError ? null : usageFromRpc(data);
  }

  let connectStatus: ConnectStatus = "not_connected";
  let stripeAccountId: string | null = null;
  let payoutsEnabled = false;
  if (session.orgRole === "owner" || session.orgRole === "admin") {
    const { data: connect } = await supabase
      .from("org_stripe_connect")
      .select("status, stripe_account_id, payouts_enabled")
      .eq("org_id", session.orgId)
      .maybeSingle();
    if (connect?.status) connectStatus = connect.status;
    stripeAccountId = connect?.stripe_account_id ?? null;
    payoutsEnabled = Boolean(connect?.payouts_enabled);
  } else {
    const { data: ready } = await supabase.rpc("org_payments_ready");
    connectStatus = ready ? "ready" : "not_connected";
  }

  return (
    <div className={headingSturdy.variable}>
      <PageHeader title="Settings" description="Company profile and defaults" />
      <div className="page-pad flex flex-col gap-6">
        {canEdit ? <UsageCard imagerySessions={usage?.imagerySessions ?? null} measurements={usage?.measurements ?? null} /> : null}
        <OrgSettingsForm
          org={org}
          canEdit={canEdit}
          isOwner={isOwner}
          tab={tab}
          branding={<BrandingForm org={org} canEdit={canEdit} />}
          payments={
            <>
              <StripeConnectCard
                isOwner={isOwner}
                status={connectStatus}
                accountLast4={accountLast4(stripeAccountId)}
                payoutsEnabled={payoutsEnabled}
              />
              <WisetackCard />
              <LateFeeCard
                flatCents={org.late_fee_flat_cents}
                feeBps={org.late_fee_bps}
                graceDays={org.late_fee_grace_days}
                canEdit={canEdit}
              />
            </>
          }
          leadForm={
            <>
              <LeadFormEmbedCard isOwner={isOwner} origin={appOrigin} slug={formSlug} />
              <LeadConnectorsCard isOwner={isOwner} />
            </>
          }
        />
      </div>
    </div>
  );
}
