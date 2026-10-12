import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrg } from "@/lib/auth/session";
import { NewCustomerDialog } from "./new-customer-dialog";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  const session = await requireOrg();
  const { q, type, status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("accounts")
    .select("id, name, type, status, phone, email, city:billing_city, parent_account_id, properties(count)")
    .eq("org_id", session.orgId)
    .order("name")
    .limit(200);
  if (q) query = query.ilike("name", `%${q}%`);
  if (type === "residential" || type === "commercial") query = query.eq("type", type);
  if (status === "lead" || status === "active" || status === "inactive") query = query.eq("status", status);
  const { data: accounts, error } = await query;

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Customers and prospects, residential and commercial"
        actions={
          <>
            <Button variant="outline" render={<Link href="/accounts/import" />}>
              Import
            </Button>
            <NewCustomerDialog />
          </>
        }
      />
      <div className="page-body">
        <nav aria-label="Account segments" className="flex flex-wrap gap-1">
          {[
            { label: "All", href: q ? `?q=${encodeURIComponent(q)}` : "/accounts", current: !type && status !== "lead" },
            { label: "Residential", href: `?type=residential${q ? `&q=${encodeURIComponent(q)}` : ""}`, current: type === "residential" },
            { label: "Commercial", href: `?type=commercial${q ? `&q=${encodeURIComponent(q)}` : ""}`, current: type === "commercial" },
            { label: "Leads", href: `?status=lead${q ? `&q=${encodeURIComponent(q)}` : ""}`, current: status === "lead" },
          ].map((segment) => (
            <Link
              key={segment.label}
              href={segment.href}
              aria-current={segment.current ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm aria-[current=page]:bg-foreground aria-[current=page]:text-background"
            >
              {segment.label}
            </Link>
          ))}
        </nav>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="account-search" className="text-sm">Search</label>
            <Input id="account-search" name="q" placeholder="Search by name" defaultValue={q ?? ""} className="w-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="account-type" className="text-sm">Type</label>
            <NativeSelect id="account-type" name="type" defaultValue={type ?? ""} className="w-full">
              <option value="">All types</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </NativeSelect>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="account-status" className="text-sm">Status</label>
            <NativeSelect id="account-status" name="status" defaultValue={status ?? ""} className="w-full">
              <option value="">All statuses</option>
              <option value="lead">Lead</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" className="sm:self-end">
            Filter
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load accounts</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !accounts || accounts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No accounts yet</EmptyTitle>
              <EmptyDescription>Create your first customer, or let leads create them automatically.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
                <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-end">Properties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    {a.parent_account_id ? (
                      <span className="ml-2 text-xs text-muted-foreground">child site</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="capitalize">{a.type}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "secondary" : "outline"}>{a.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.phone ?? a.email ?? "—"}</TableCell>
                  <TableCell className="num text-end">{a.properties?.[0]?.count ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
