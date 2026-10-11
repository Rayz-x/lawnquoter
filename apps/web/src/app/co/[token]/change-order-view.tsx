import { formatMoney } from "@/lib/money";
import type { PublicChangeOrder } from "@/lib/billing/change-order";
import { ChangeOrderAcceptForm } from "./accept-form";

function dollars(cents: number) {
  return formatMoney(cents / 100, { cents: true });
}

export function ChangeOrderView({ token, payload }: { token: string; payload: PublicChangeOrder }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-10">
      <p className="text-sm text-muted-foreground">{payload.org.name}</p>
      <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight">Change order</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        For {payload.account_name}. Approve a higher billing amount for one line on your accepted proposal.
      </p>

      <section className="mt-8 space-y-3" aria-labelledby="co-summary">
        <h2 id="co-summary" className="sr-only">
          Change order summary
        </h2>
        <div className="rounded-xl border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line</div>
          <div className="mt-1 text-lg font-medium" data-testid="change-order-line">
            {payload.line_name}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current cap</div>
            <div className="mt-1 font-heading text-2xl font-bold tabular-nums" data-testid="change-order-prior-cap">
              {dollars(payload.prior_cap_cents)}
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New amount</div>
            <div className="mt-1 font-heading text-2xl font-bold tabular-nums" data-testid="change-order-proposed">
              {dollars(payload.proposed_amount_cents)}
            </div>
          </div>
        </div>
        {payload.reason ? (
          <p className="text-sm text-muted-foreground" data-testid="change-order-reason">
            {payload.reason}
          </p>
        ) : null}
      </section>

      <ChangeOrderAcceptForm token={token} status={payload.status} />

      <p className="mt-8 text-xs text-muted-foreground">
        {payload.org.phone}
        {payload.org.email ? (
          <>
            {" "}
            ·{" "}
            <a className="underline" href={`mailto:${payload.org.email}`}>
              {payload.org.email}
            </a>
          </>
        ) : null}
      </p>
    </main>
  );
}
