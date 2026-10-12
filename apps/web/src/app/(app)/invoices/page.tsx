import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldHint } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { CreateBatchForm } from "./create-batch-form";

export const metadata: Metadata = { title: "Invoices" };

const STATUSES = ["draft", "issued", "paid", "void"] as const;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function monthBounds(isoDate = new Date()): { start: string; end: string } {
  const y = isoDate.getFullYear();
  const m = isoDate.getMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function invoiceLabel(number: number | null, status: string) {
  if (number != null) return `INV-${String(number).padStart(4, "0")}`;
  return status === "draft" ? "Draft" : "Unnumbered";
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Invoices" description="Draft and issued customer invoices" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Invoices stay in the office. Crews see their route in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const { status } = await searchParams;
  const statusFilter = STATUSES.find((item) => item === status);
  const canCreate = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);
  const period = monthBounds();
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id, number, status, source, total_cents, currency, created_at, issued_at, accounts(name)")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: invoices, error } = await query;

  return (
    <>
      <PageHeader title="Invoices" description="One draft per account from billable visits" />
      <div className="page-body space-y-6">
        {canCreate ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Create invoices for the period</h2>
            <p className="text-sm text-muted-foreground">
              Pulls completed visits with an after photo that are not billed and not held.
            </p>
            <CreateBatchForm defaultStart={period.start} defaultEnd={period.end} />
          </section>
        ) : null}

        <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="invoice-status" className="text-sm">Status</label>
            <NativeSelect id="invoice-status" name="status" aria-describedby="invoice-status-hint" defaultValue={statusFilter ?? ""} className="w-full sm:w-auto">
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
            <FieldHint id="invoice-status-hint">Shows drafts, issued invoices, paid ones, or void ones.</FieldHint>
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load invoices</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !invoices || invoices.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{statusFilter ? "No invoices match" : "No invoices yet"}</EmptyTitle>
              <EmptyDescription>
                {statusFilter
                  ? "Try another status, or clear the filter."
                  : canCreate
                    ? "Create invoices for this month when visits are ready to bill."
                    : "Drafts appear here after office creates them."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const account = one(invoice.accounts);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                        {invoiceLabel(invoice.number, invoice.status)}
                      </Link>
                    </TableCell>
                    <TableCell>{account?.name ?? "Account"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(invoice.total_cents / 100, { cents: true })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
