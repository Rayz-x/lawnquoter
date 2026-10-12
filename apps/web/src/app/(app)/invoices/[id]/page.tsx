import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextDocumentOffer } from "@/components/messaging/text-document-offer";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { IssueInvoiceButton } from "./issue-invoice-button";
import { requireOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invoice" };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function invoiceLabel(number: number | null, status: string) {
  if (number != null) return `INV-${String(number).padStart(4, "0")}`;
  return status === "draft" ? "Draft invoice" : "Invoice";
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Invoices stay in the office. Crews see their route in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "id, number, status, source, currency, subtotal_cents, tax_cents, total_cents, created_at, issued_at, notes, accounts(name)",
    )
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();

  if (error) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this invoice</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!invoice) notFound();

  const { data: lines, error: linesError } = await supabase
    .from("invoice_lines")
    .select(
      "id, description, quantity, unit_price_cents, amount_cents, sort, service_date, property_id, properties(formatted_address, address_line1, city)",
    )
    .eq("invoice_id", id)
    .eq("org_id", session.orgId)
    .order("sort");

  const account = one(invoice.accounts);
  const title = invoiceLabel(invoice.number, invoice.status);

  return (
    <>
      <PageHeader
        title={title}
        description={account?.name ? `${account.name} · ${invoice.status}` : invoice.status}
        actions={
          <>
            <TextDocumentOffer
              purpose="invoice"
              id={invoice.id}
              label="Text invoice"
              allowed={hasRole(session.orgRole, CUSTOMER_EDIT_ROLES) && (invoice.status === "issued" || invoice.status === "paid")}
            />
            <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">
              All invoices
            </Link>
          </>
        }
      />
      <div className="page-body space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {invoice.status}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {invoice.source}
          </Badge>
          {invoice.status === "draft" ? (
            <p className="text-sm text-muted-foreground">Draft — numbering and tax land when issued.</p>
          ) : null}
          {invoice.status === "draft" && hasRole(session.orgRole, ADMIN_ROLES) ? (
            <IssueInvoiceButton invoiceId={invoice.id} />
          ) : null}
        </div>

        {linesError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load lines</AlertTitle>
            <AlertDescription>{linesError.message}</AlertDescription>
          </Alert>
        ) : !lines || lines.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No lines</EmptyTitle>
              <EmptyDescription>This draft has no billed visits yet.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Service date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const property = one(line.properties);
                const address =
                  property?.formatted_address ||
                  [property?.address_line1, property?.city].filter(Boolean).join(", ") ||
                  "—";
                return (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.description}</TableCell>
                    <TableCell>{address}</TableCell>
                    <TableCell className="tabular-nums">
                      {line.service_date
                        ? new Date(`${line.service_date}T12:00:00`).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(line.amount_cents / 100, { cents: true })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <dl className="ms-auto grid w-full max-w-xs gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(invoice.subtotal_cents / 100, { cents: true })}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="tabular-nums">{formatMoney(invoice.tax_cents / 100, { cents: true })}</dd>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(invoice.total_cents / 100, { cents: true })}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
