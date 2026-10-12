import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { QBO_NOT_CONNECTED, qboConfigured } from "@/lib/billing/qbo";
import { createClient } from "@/lib/supabase/server";
import { QboConflictChoices } from "./conflict-choices";

export const metadata: Metadata = { title: "QuickBooks" };

export default async function QuickBooksPage() {
  const session = await requireOrg();
  const canResolve = session.orgRole === "owner" || session.orgRole === "admin";
  const supabase = await createClient();
  const [{ data: log, error: logError }, { data: conflicts, error: conflictError }] = await Promise.all([
    supabase.from("qbo_sync_log").select("id, direction, entity, outcome, detail, created_at").eq("org_id", session.orgId).order("created_at", { ascending: false }).limit(50),
    supabase.from("qbo_conflicts").select("id, local_name, remote_name, status").eq("org_id", session.orgId).eq("status", "open").order("created_at", { ascending: false }),
  ]);
  const error = logError?.message ?? conflictError?.message;

  return (
    <>
      <PageHeader title="QuickBooks" description="Customers, invoices, and payments sync both ways. Child accounts map to sub-customers." />
      <div className="page-body flex flex-col gap-4">
        {!qboConfigured() ? <p className="text-sm text-muted-foreground">{QBO_NOT_CONNECTED}</p> : null}
        {qboConfigured() && canResolve ? (
          <Link href="/api/qbo/connect" className="text-sm underline">
            Connect QuickBooks
          </Link>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load QuickBooks</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Conflicts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(conflicts ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No open conflicts.</p> : null}
            {(conflicts ?? []).map((conflict) => (
              <div key={conflict.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {conflict.local_name} here, {conflict.remote_name} in QuickBooks
                </span>
                <QboConflictChoices conflictId={conflict.id} canResolve={canResolve} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sync log</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(log ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No sync activity yet.</p> : null}
            {(log ?? []).map((entry) => (
              <p key={entry.id} className="text-sm">
                {entry.direction} {entry.entity}: {entry.outcome}
                {entry.detail ? ` — ${entry.detail}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
        <Link href="/settings" className="text-sm underline">
          Back to settings
        </Link>
      </div>
    </>
  );
}
