import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "@/app/q/[token]/heading-font";
import { BrandingForm } from "./branding-form";
import { OrgSettingsForm } from "./org-settings-form";

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
  const initial = tab === "branding" || tab === "payments" ? tab : "profile";

  return (
    <div className={headingSturdy.variable}>
      <PageHeader title="Company settings" description="Profile, branding, and payments" />
      <div className="page-pad">
        <Tabs defaultValue={initial}>
          <TabsList className="group-data-horizontal/tabs:h-9">
            <TabsTrigger className="px-3.5 py-1.5" value="profile">Profile</TabsTrigger>
            <TabsTrigger className="px-3.5 py-1.5" value="branding">Branding</TabsTrigger>
            <TabsTrigger className="px-3.5 py-1.5" value="payments">Payments</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Company profile</CardTitle>
                <CardDescription>Shown on quotes, proposals, invoices and your public quote pages.</CardDescription>
              </CardHeader>
              <CardContent>
                <OrgSettingsForm org={org} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="branding" className="mt-4">
            <BrandingForm org={org} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="payments" className="mt-4">
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
                {process.env.STRIPE_SECRET_KEY
                  ? "Stripe secret is configured."
                  : "Stripe is not configured yet — acceptances still record an ESIGN audit trail."}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
