import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { completeTask } from "./actions";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireOrg();
  const { error } = await searchParams;
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Tasks" />
        <div className="page-body"><Alert><AlertTitle>Office only</AlertTitle><AlertDescription>Call tasks stay in the office.</AlertDescription></Alert></div>
      </>
    );
  }
  const supabase = await createClient();
  const { data: tasks } = await supabase.from("tasks").select("id, title, status, due_on, quote_id").eq("org_id", session.orgId).eq("status", "open").order("due_on");
  const canEdit = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);
  return (
    <>
      <PageHeader title="Tasks" description="Calls to make after a quote goes unanswered" />
      <div className="page-body flex flex-col gap-3">
        {error ? <Alert variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        <ul className="flex flex-col gap-2">
          {(tasks ?? []).map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{task.title}{task.quote_id ? <> · <Link className="underline" href={`/quotes/${task.quote_id}`}>Quote</Link></> : null}</span>
              {canEdit ? <form action={completeTask}><input type="hidden" name="id" value={task.id} /><Button type="submit" variant="outline">Done</Button></form> : null}
            </li>
          ))}
          {(tasks ?? []).length === 0 ? <li className="text-sm text-muted-foreground">No open call tasks.</li> : null}
        </ul>
      </div>
    </>
  );
}
