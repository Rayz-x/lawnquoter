import type { Metadata } from "next";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { a2pStep } from "@/lib/messaging/a2p";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";
import { saveA2p, submitA2pForm } from "./actions";

export const metadata: Metadata = { title: "Texting registration" };

const STEPS = ["Business", "Brand", "Campaign"];

export default async function TextingSetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireOrg();
  const { error } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Texting registration" description="Carrier approval for business texts" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not register texting.</AlertDescription></Alert></div>
      </>
    );
  }
  const supabase = await createClient();
  const { data: row } = await supabase.from("org_sms_registrations").select("legal_name, ein, website, contact_email, sample_message, brand_status, campaign_status, last_error").eq("org_id", session.orgId).maybeSingle();
  const step = a2pStep({ brandStatus: row?.brand_status ?? "draft", campaignStatus: row?.campaign_status ?? "draft" });
  const connected = readTwilioConfig(process.env) !== null;
  const canEdit = hasRole(session.orgRole, ADMIN_ROLES);
  return (
    <>
      <PageHeader title="Texting registration" description="Business details, then the carrier brand and campaign" />
      <div className="page-body flex max-w-xl flex-col gap-4">
        {error ? <Alert variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {!connected ? <Alert><AlertTitle>Texting</AlertTitle><AlertDescription>{TWILIO_NOT_CONNECTED}</AlertDescription></Alert> : null}
        <ol className="flex flex-wrap gap-2 text-sm">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? "font-semibold" : "text-muted-foreground"}>{index + 1}. {label}</li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">Brand {row?.brand_status ?? "draft"} · Campaign {row?.campaign_status ?? "draft"}</p>
        {row?.last_error ? <p className="text-sm text-destructive">{row.last_error}</p> : null}
        {canEdit ? (
          <form action={saveA2p} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">Legal business name<Input name="legal_name" defaultValue={row?.legal_name ?? ""} required /></label>
            <label className="flex flex-col gap-1 text-sm">EIN<Input name="ein" defaultValue={row?.ein ?? ""} inputMode="numeric" required /></label>
            <label className="flex flex-col gap-1 text-sm">Website<Input name="website" type="url" defaultValue={row?.website ?? ""} required /></label>
            <label className="flex flex-col gap-1 text-sm">Business email<Input name="contact_email" type="email" defaultValue={row?.contact_email ?? ""} required /></label>
            <label className="flex flex-col gap-1 text-sm">Sample text<textarea name="sample_message" defaultValue={row?.sample_message ?? ""} required rows={3} className="rounded-md border bg-background px-3 py-2" /></label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save draft</Button>
            </div>
          </form>
        ) : <p className="text-sm text-muted-foreground">An owner or admin submits this registration.</p>}
        {canEdit && connected ? (
          <form action={submitA2pForm}><Button type="submit" variant="outline">Submit to carriers</Button></form>
        ) : null}
      </div>
    </>
  );
}
