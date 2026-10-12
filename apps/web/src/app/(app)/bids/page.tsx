import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { BID_STATUS_LABELS, type BidStatus } from "@/lib/bids/package";
import { createClient } from "@/lib/supabase/server";
import { createBidPackage } from "./actions";

export const metadata: Metadata = { title: "Bids" };

export default async function BidsPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Bids" description="Commercial portfolios and bid packages" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Crews open a site walk from the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  const supabase = await createClient();
  const [{ data: packages }, { data: accounts }] = await Promise.all([
    supabase.from("bid_packages").select("id, title, status, due_on, walk_on, account_id").order("due_on").limit(200),
    supabase.from("accounts").select("id, name").eq("type", "commercial").order("name").limit(200),
  ]);
  const names = new Map((accounts ?? []).map((account) => [account.id, account.name]));
  const canEdit = hasRole(session.orgRole, SALES_ROLES);

  return (
    <>
      <PageHeader title="Bids" description="Portfolios, due dates, and site walks" />
      <div className="page-body space-y-8">
        {canEdit ? (
          <form action={createBidPackage} className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Portfolio</span>
              <select name="account_id" required className="h-9 rounded-md border bg-background px-2">
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Package</span>
              <Input name="title" required placeholder="2027 grounds" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Walk</span>
              <Input name="walk_on" type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Due</span>
              <Input name="due_on" type="date" />
            </label>
            <Button type="submit" className="sm:col-span-2 w-fit">
              Create package
            </Button>
          </form>
        ) : null}
        <section className="space-y-2">
          <h2 className="font-heading text-lg">Calendar</h2>
          {(packages ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No bid packages yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Portfolio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Walk</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(packages ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/bids/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell>{names.get(row.account_id) ?? "Portfolio"}</TableCell>
                    <TableCell>{BID_STATUS_LABELS[row.status as BidStatus]}</TableCell>
                    <TableCell>{row.walk_on ?? "—"}</TableCell>
                    <TableCell>{row.due_on ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
