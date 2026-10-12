import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { PURPOSE_LABELS, type MessageChannel, type MessagePurpose } from "@/lib/messaging/template";
import { createClient } from "@/lib/supabase/server";
import { TemplateEditor, type TemplateEditorValue } from "./template-editor";

export const metadata: Metadata = { title: "Message templates" };

function asChannel(value: string): MessageChannel {
  return value === "email" ? "email" : "sms";
}
function asPurpose(value: string): MessagePurpose {
  return value in PURPOSE_LABELS ? (value as MessagePurpose) : "general";
}

export default async function MessageTemplatesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await requireOrg();
  const { id } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Message templates" description="Wording for quotes, invoices, and texts" />
        <div className="page-body">
          <Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Crews do not edit customer messages.</AlertDescription></Alert>
        </div>
      </>
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("message_templates").select("id, name, channel, purpose, subject, body, is_default").eq("org_id", session.orgId).order("name");
  const templates = data ?? [];
  const selected = templates.find((template) => template.id === id) ?? null;
  const initial: TemplateEditorValue | null = selected
    ? { id: selected.id, name: selected.name, channel: asChannel(selected.channel), purpose: asPurpose(selected.purpose), subject: selected.subject ?? "", body: selected.body, isDefault: selected.is_default }
    : null;
  return (
    <>
      <PageHeader title="Message templates" description="Wording for quotes, invoices, and texts" />
      <div className="page-pad flex flex-col gap-4 lg:flex-row lg:items-start">
        <nav aria-label="Templates" className="flex w-full flex-col gap-1 text-sm lg:w-56 lg:shrink-0">
          <Link href="/settings/messages" className="rounded-md px-2 py-1.5 hover:bg-muted">New template</Link>
          {templates.map((template) => (
            <Link key={template.id} href={`/settings/messages?id=${template.id}`} className="rounded-md px-2 py-1.5 hover:bg-muted" aria-current={template.id === id ? "page" : undefined}>
              {template.name}
              <span className="block text-xs text-muted-foreground">
                {template.channel === "sms" ? "Text" : "Email"} · {PURPOSE_LABELS[asPurpose(template.purpose)]}
                {template.is_default ? " · Default" : ""}
              </span>
            </Link>
          ))}
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
          {templates.length === 0 ? <p className="px-2 text-sm text-muted-foreground">No templates yet.</p> : null}
        </nav>
        <div className="min-w-0 flex-1">
          <TemplateEditor key={initial?.id ?? "new"} initial={initial} canEdit={hasRole(session.orgRole, SALES_ROLES)} />
        </div>
      </div>
    </>
  );
}
