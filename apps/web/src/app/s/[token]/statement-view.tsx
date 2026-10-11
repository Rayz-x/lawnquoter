import type { PublicAccountStatement } from "@/lib/billing/public-statement";
import type { PublicOrg } from "@/lib/brand/public-org";
import { formatOrgAddress } from "@/lib/brand/public-org";
import { formatMoney } from "@/lib/money";

function dollars(cents: number): string {
  return formatMoney(cents / 100, { cents: true });
}

export function StatementView({
  payload,
}: {
  payload: Omit<PublicAccountStatement, "org"> & { org: PublicOrg };
}) {
  const address = formatOrgAddress(payload.org);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-10">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Account statement</p>
        <h1 className="text-3xl font-semibold tracking-tight">{payload.org.name}</h1>
        {address.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </header>

      <section className="space-y-1">
        <h2 className="text-xl font-semibold">{payload.account_name}</h2>
        <p className="text-sm text-muted-foreground">
          {payload.from} through {payload.to}
        </p>
      </section>

      <section className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Opening balance</span>
          <span className="tabular-nums font-medium">{dollars(payload.opening_cents)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Invoices</span>
          <span className="tabular-nums">{dollars(payload.invoice_cents)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Payments</span>
          <span className="tabular-nums">−{dollars(payload.payment_cents)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Credits</span>
          <span className="tabular-nums">−{dollars(payload.credit_cents)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 text-base">
          <span className="font-semibold">Closing balance</span>
          <span className="tabular-nums font-semibold">{dollars(payload.closing_cents)}</span>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
        {payload.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          payload.lines.map((line) => (
            <div
              key={`${line.kind}-${line.id}`}
              className="flex items-start justify-between gap-4 border-b border-border py-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm leading-snug">{line.label}</p>
                <p className="text-xs text-muted-foreground">{line.on}</p>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums">
                {line.kind === "invoice" ? dollars(line.amount_cents) : `−${dollars(line.amount_cents)}`}
              </p>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
