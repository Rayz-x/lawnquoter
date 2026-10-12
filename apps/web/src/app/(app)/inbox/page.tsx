import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { SectionCard } from "@/components/entry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";
import { saveSmsNumber, sendText } from "./actions";

export const metadata: Metadata = { title: "Texts" };

type TextRow = { id: string; direction: string; from_address: string; to_address: string; body: string; status: string };

function party(row: TextRow) {
  return row.direction === "in" ? row.from_address : row.to_address;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ phone?: string; error?: string }> }) {
  const session = await requireOrg();
  const { phone, error: formError } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Texts" description="Texts with customers" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not read customer texts.</AlertDescription></Alert></div>
      </>
    );
  }
  const connected = readTwilioConfig(process.env) !== null;
  const supabase = await createClient();
  const [{ data: org }, { data, error }] = await Promise.all([
    supabase.from("orgs").select("sms_number").eq("id", session.orgId).maybeSingle(),
    supabase.from("messages").select("id, direction, from_address, to_address, body, status, occurred_at").eq("org_id", session.orgId).eq("channel", "sms").order("occurred_at", { ascending: false }).limit(200),
  ]);
  const rows = (data ?? []) as TextRow[];
  const threads = new Map<string, TextRow>();
  for (const row of [...rows].reverse()) threads.set(party(row), row);
  const selected = phone && threads.has(phone) ? phone : threads.keys().next().value ?? phone ?? "";
  const thread = selected ? rows.filter((row) => party(row) === selected).slice().reverse() : [];
  const canSend = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);
  return (
    <>
      <PageHeader title="Texts" description="Texts with customers" />
      <div className="page-pad flex flex-col gap-4">
        {connected ? null : <Alert><AlertTitle>Texting is off</AlertTitle><AlertDescription>{TWILIO_NOT_CONNECTED}</AlertDescription></Alert>}
        {formError ? <Alert variant="destructive"><AlertTitle>Could not send</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert> : null}
        <SectionCard title="Your number" heading="h2" description="Inbound texts match this number to your company.">
          {hasRole(session.orgRole, ADMIN_ROLES) ? (
            <form action={saveSmsNumber} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Texting number
                <input name="sms_number" defaultValue={org?.sms_number ?? ""} inputMode="tel" autoComplete="tel" className="native-control max-lg:h-11" />
              </label>
              <Button type="submit" variant="outline">Save number</Button>
            </form>
          ) : <p className="text-sm">{org?.sms_number || "No texting number yet."}</p>}
        </SectionCard>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <nav aria-label="Text threads" className="flex w-full flex-col gap-1 text-sm lg:w-64 lg:shrink-0">
            {[...threads.entries()].reverse().map(([number, row]) => (
              <Link key={number} href={`/inbox?phone=${encodeURIComponent(number)}`} className="rounded-md px-2 py-1.5 hover:bg-muted" aria-current={number === selected ? "page" : undefined}>
                {number}<span className="block truncate text-xs text-muted-foreground">{row.body}</span>
              </Link>
            ))}
            {threads.size === 0 ? <p className="px-2 text-sm text-muted-foreground">No texts yet.</p> : null}
          </nav>
          <SectionCard title={selected || "New text"} heading="h2" className="min-w-0 flex-1">
            <div className="flex flex-col gap-3">
              {thread.map((row) => <p key={row.id} className="text-sm"><span className="font-medium">{row.direction === "out" ? "You" : row.from_address}</span>{" · "}{row.status === "failed" ? "Not sent. " : ""}{row.body}</p>)}
              {canSend ? (
                <form action={sendText} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">Mobile number
                    <input name="to" defaultValue={selected} inputMode="tel" className="native-control max-lg:h-11" required />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">Message
                    <textarea name="body" required disabled={!connected} className="native-control min-h-20" />
                  </label>
                  <Button type="submit" disabled={!connected}>Send text</Button>
                </form>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
