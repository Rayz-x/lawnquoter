import { invoiceLineCustomerCopy } from "@/lib/billing/invoice-line-copy";
import type { PublicInvoice } from "@/lib/billing/public-invoice";
import { formatMoney } from "@/lib/money";
import { formatOrgAddress } from "@/lib/brand/public-org";

function cents(value: number): number {
  return value / 100;
}

export function InvoiceView({
  token,
  payload,
}: {
  token: string;
  payload: PublicInvoice;
}) {
  const address = formatOrgAddress(payload.org);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-10">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Invoice</p>
        <h1 className="text-3xl font-semibold tracking-tight">{payload.org.name}</h1>
        {address.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{payload.number_label ?? "Invoice"}</h2>
        <p className="text-sm text-muted-foreground">Bill to {payload.account_name}</p>
        {payload.due_on ? <p className="text-sm text-muted-foreground">Due {payload.due_on}</p> : null}
        <p className="text-sm capitalize text-muted-foreground">Status: {payload.status}</p>
      </section>

      <section className="space-y-3">
        {payload.lines.map((line) => {
          const copy = invoiceLineCustomerCopy({
            description: line.description,
            amountCents: line.amount_cents,
            estimateLowCents: line.estimate_low_cents,
            estimateHighCents: line.estimate_high_cents,
          });
          return (
            <div key={line.id} className="flex items-start justify-between gap-4 border-b border-border py-3">
              <p className="text-sm leading-snug">{copy}</p>
              <p className="shrink-0 text-sm font-medium">{formatMoney(cents(line.amount_cents))}</p>
            </div>
          );
        })}
      </section>

      <section className="space-y-1">
        {payload.tax_label ? <p className="text-sm text-muted-foreground">{payload.tax_label}</p> : null}
        <p className="text-2xl font-semibold">Total {formatMoney(cents(payload.total_cents))}</p>
        <a className="text-sm text-primary underline-offset-4 hover:underline" href={`/i/${token}/pdf`}>
          Download PDF
        </a>
      </section>
    </main>
  );
}
