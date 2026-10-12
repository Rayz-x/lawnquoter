import type { Metadata } from "next";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { loadSendingDomains, RESEND_NOT_CONNECTED, resendApiKey } from "@/lib/email/sending-domain";
import { addSendingDomain } from "./actions";

export const metadata: Metadata = { title: "Sending domain" };

export default async function SendingDomainPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireOrg();
  const { error } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Sending domain" description="SPF and DKIM for company email" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not set the sending domain.</AlertDescription></Alert></div>
      </>
    );
  }
  const key = resendApiKey(process.env);
  const domains = key ? await loadSendingDomains(key, (url, init) => fetch(url, init)) : [];
  const from = process.env.EMAIL_FROM?.trim() || "";
  const canEdit = hasRole(session.orgRole, ADMIN_ROLES);
  return (
    <>
      <PageHeader title="Sending domain" description="SPF and DKIM for company email" />
      <div className="page-body flex max-w-2xl flex-col gap-4">
        {error ? <Alert variant="destructive"><AlertTitle>Could not add the domain</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {!key ? <Alert><AlertTitle>Email</AlertTitle><AlertDescription>{RESEND_NOT_CONNECTED}</AlertDescription></Alert> : null}
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Mail from your own domain needs SPF, which names the servers allowed to send for that domain, and DKIM, which signs each message so inboxes can tell it came from you.</p>
          <p>Add the Resend key. This page then lists the records Resend creates for the domain. Copy each name, type, and value into the DNS host. Those values come from Resend.</p>
          {from ? <p>From address: {from}</p> : <p>Set EMAIL_FROM to an address on the verified domain.</p>}
        </div>
        {domains.map((domain) => (
          <section key={domain.id} className="flex flex-col gap-2 rounded-md border p-3">
            <h2 className="text-sm font-medium">{domain.name}</h2>
            <p className="text-sm capitalize text-muted-foreground">{domain.status.replaceAll("_", " ")}</p>
            {domain.records.length === 0 ? <p className="text-sm text-muted-foreground">Resend has not returned DNS records for this domain yet.</p> : null}
            <ul className="flex flex-col gap-3">
              {domain.records.map((record) => (
                <li key={`${record.purpose}-${record.type}-${record.name}`} className="text-sm">
                  <p className="font-medium">{record.purpose} · {record.type}{record.status ? ` · ${record.status}` : ""}</p>
                  <p className="break-all text-muted-foreground">Name {record.name}</p>
                  <p className="break-all">Value {record.value}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {key && canEdit ? (
          <form action={addSendingDomain} className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-1 text-sm"><label htmlFor="sending-domain">Domain</label><Input id="sending-domain" name="domain" placeholder="mail.example.com" required /></div>
            <Button type="submit" className="w-fit">Add domain</Button>
          </form>
        ) : null}
        {key && !canEdit ? <p className="text-sm text-muted-foreground">An owner or admin adds the domain.</p> : null}
      </div>
    </>
  );
}
