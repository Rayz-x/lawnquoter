import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { PAYMENT_LIST_METHODS, PAYMENT_LIST_STATUSES } from "@/lib/billing/payments-list";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadPaymentsPageData } from "./load-payments";
import { StatementLinkForm } from "./statement-link-form";

export const metadata: Metadata = { title: "Payments" };

function dollars(cents: number): string {
  return formatMoney(cents / 100, { cents: true });
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

function defaultPeriod(): { from: string; to: string; asOf: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const asOf = `${y}-${m}-${d}`;
  return { from: `${y}-${m}-01`, to: asOf, asOf };
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; method?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Payments" description="Payments, aging, and account statements" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Payment ledgers stay in the office. Crews use the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const filters = await searchParams;
  const period = defaultPeriod();
  const supabase = await createClient();
  const data = await loadPaymentsPageData(
    supabase as never,
    session.orgId,
    { status: filters.status, method: filters.method },
    period.asOf,
  );
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const { aging } = data;

  return (
    <>
      <PageHeader title="Payments" description="Payments, aging, and account statements" />
      <div className="page-body space-y-8">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Aging</h2>
          <p className="text-sm text-muted-foreground">
            Open AR as of {period.asOf}. Buckets sum to open receivables.
          </p>
          <dl className="grid gap-3 sm:grid-cols-5">
            {(
              [
                ["Current", aging.current],
                ["1–30", aging.days1to30],
                ["31–60", aging.days31to60],
                ["60+", aging.days60plus],
                ["Open AR", aging.openAr],
              ] as const
            ).map(([name, cents]) => (
              <div key={name} className="space-y-1">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{name}</dt>
                <dd className="text-xl font-semibold tabular-nums">{dollars(cents)}</dd>
              </div>
            ))}
          </dl>
          {aging.openAr !== data.openArCheck ? (
            <Alert variant="destructive">
              <AlertTitle>Aging mismatch</AlertTitle>
              <AlertDescription>
                Bucket total {dollars(aging.openAr)} does not match open AR {dollars(data.openArCheck)}.
              </AlertDescription>
            </Alert>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Payments</h2>
          <form className="flex flex-wrap items-center gap-2">
            <NativeSelect name="status" defaultValue={data.status ?? ""} className="w-auto" aria-label="Status">
              <option value="">All statuses</option>
              {PAYMENT_LIST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="method" defaultValue={data.method ?? ""} className="w-auto" aria-label="Method">
              <option value="">All methods</option>
              {PAYMENT_LIST_METHODS.map((method) => (
                <option key={method} value={method}>
                  {label(method)}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          {data.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load payments</AlertTitle>
              <AlertDescription>{data.error}</AlertDescription>
            </Alert>
          ) : data.payments.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {data.status || data.method ? "No payments match" : "No payments yet"}
                </EmptyTitle>
                <EmptyDescription>
                  {data.status || data.method
                    ? "Try another status or method, or clear the filters."
                    : "Succeeded card, cash, check, and account-credit payments show here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      {payment.accountId ? (
                        <Link href={`/accounts/${payment.accountId}`} className="font-medium hover:underline">
                          {payment.accountName ?? "Account"}
                        </Link>
                      ) : (
                        (payment.accountName ?? "Account")
                      )}
                    </TableCell>
                    <TableCell className="capitalize">{label(payment.method)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {label(payment.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {payment.receivedAt ? payment.receivedAt.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(payment.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Account statement</h2>
          <p className="text-sm text-muted-foreground">
            Mint a token link for {period.from} through {period.to}. Closing = opening + invoices − payments −
            credits.
          </p>
          <StatementLinkForm
            accounts={data.accounts}
            from={period.from}
            to={period.to}
            appOrigin={appOrigin}
          />
        </section>
      </div>
    </>
  );
}
