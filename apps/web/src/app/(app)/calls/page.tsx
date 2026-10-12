import type { Metadata } from "next";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { CALLRAIL_NOT_CONNECTED, readCallrailSecret } from "@/lib/messaging/calls";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";
import { saveTrackingNumber } from "./actions";

export const metadata: Metadata = { title: "Calls" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireOrg();
  const { error } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Calls" description="Tracked calls and recordings" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not see call recordings.</AlertDescription></Alert></div>
      </>
    );
  }
  const supabase = await createClient();
  const [{ data: org }, { data: calls }] = await Promise.all([
    supabase.from("orgs").select("call_tracking_number").eq("id", session.orgId).maybeSingle(),
    supabase.from("calls").select("id, direction, from_address, to_address, duration_seconds, recording_url, provider, occurred_at").eq("org_id", session.orgId).order("occurred_at", { ascending: false }).limit(50),
  ]);
  const callrail = readCallrailSecret(process.env) !== null;
  const twilio = readTwilioConfig(process.env) !== null;
  return (
    <>
      <PageHeader title="Calls" description="CallRail and Twilio recordings for this company" />
      <div className="page-body flex flex-col gap-4">
        {error ? <Alert variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {!callrail ? <Alert><AlertTitle>CallRail</AlertTitle><AlertDescription>{CALLRAIL_NOT_CONNECTED}</AlertDescription></Alert> : null}
        {!twilio ? <Alert><AlertTitle>Twilio</AlertTitle><AlertDescription>{TWILIO_NOT_CONNECTED}</AlertDescription></Alert> : null}
        {hasRole(session.orgRole, ADMIN_ROLES) ? (
          <form action={saveTrackingNumber} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">Tracking number
              <Input name="call_tracking_number" defaultValue={org?.call_tracking_number ?? ""} placeholder="555 222 0000" />
            </label>
            <Button type="submit">Save</Button>
          </form>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(calls ?? []).map((call) => (
            <li key={call.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{call.direction === "out" ? "Out" : "In"} · {call.from_address} · {call.provider}</span>
              {call.recording_url ? <a className="underline" href={call.recording_url}>Recording</a> : <span className="text-muted-foreground">No recording</span>}
            </li>
          ))}
          {(calls ?? []).length === 0 ? <li className="text-sm text-muted-foreground">No calls yet.</li> : null}
        </ul>
      </div>
    </>
  );
}
