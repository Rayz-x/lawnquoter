import type { Metadata } from "next";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { setFollowUps } from "./actions";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireOrg();
  const { error } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Follow-ups" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not run follow-ups.</AlertDescription></Alert></div>
      </>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.from("automations").select("active").eq("org_id", session.orgId).eq("purpose", "follow_up").maybeSingle();
  return (
    <>
      <PageHeader title="Follow-ups" description="After a quote is sent, with no reply and no view" />
      <div className="page-body flex max-w-xl flex-col gap-3">
        {error ? <Alert variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        <ol className="list-decimal pl-5 text-sm text-muted-foreground">
          <li>Day 2: text the customer.</li>
          <li>Day 5: email the customer.</li>
          <li>Then create a call task. A reply, a view, or an acceptance stops the sequence and does not create that call.</li>
        </ol>
        <p className="text-sm">{data?.active ? "Follow-ups are on." : "Follow-ups are off."}</p>
        {hasRole(session.orgRole, ADMIN_ROLES) ? (
          <form action={setFollowUps}>
            <input type="hidden" name="active" value={data?.active ? "off" : "on"} />
            <Button type="submit">{data?.active ? "Turn off" : "Turn on"}</Button>
          </form>
        ) : null}
      </div>
    </>
  );
}
