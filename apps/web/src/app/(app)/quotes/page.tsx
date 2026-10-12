import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrg } from "@/lib/auth/session";
import { SITE_CHECK_REQUESTED_BADGE } from "@/lib/quotes/site-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, number, title, status, site_check_status, created_at, gone_quiet_at, abandoned_at, accounts(name)")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Draft, send, and track proposals"
        actions={
          <Button render={<Link href="/quotes/new" />}>New quote</Button>
        }
      />
      <div className="page-body">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load quotes</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !quotes || quotes.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No quotes yet</EmptyTitle>
              <EmptyDescription>Create one from an account, or start here and pick the customer.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="tabular-nums">{q.number}</TableCell>
                  <TableCell>
                    <Link href={`/quotes/${q.id}`} className="font-medium hover:underline">
                      {q.title}
                    </Link>
                  </TableCell>
                  <TableCell>{q.accounts?.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="capitalize">
                        {q.status}
                      </Badge>
                      {q.abandoned_at ? (
                        <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                          Abandoned
                        </Badge>
                      ) : null}
                      {q.gone_quiet_at ? (
                        <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                          Gone quiet
                        </Badge>
                      ) : null}
                      {q.site_check_status === "requested" || q.site_check_status === "scheduled" ? (
                        <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                          {SITE_CHECK_REQUESTED_BADGE}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(q.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
