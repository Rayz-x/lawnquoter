import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { OrgSettingsForm } from "./org-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("*").eq("id", session.orgId).single();
  if (!org) return null;

  return (
    <>
      <PageHeader title="Company settings" description="Branding, contact details and defaults" />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            <CardDescription>Shown on quotes, proposals, invoices and your public quote pages.</CardDescription>
          </CardHeader>
          <CardContent>
            <OrgSettingsForm org={org} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              Stripe Connect Express for deposits, card on file, and ACH. SignWell is optional for formal commercial contracts.
              Configure <code className="text-xs">STRIPE_SECRET_KEY</code> and <code className="text-xs">SIGNWELL_API_KEY</code> on the
              server. Click-to-accept on public proposals is live without either.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {process.env.STRIPE_SECRET_KEY ? "Stripe secret is configured." : "Stripe is not configured yet — acceptances still record an ESIGN audit trail."}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
