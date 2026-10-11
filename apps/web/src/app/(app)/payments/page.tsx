import { hasRole } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DisputeFlag } from "./dispute-flag";
import { RefundButton } from "./refund-button";

type UntypedFilter = {
  eq: (col: string, value: string | boolean) => UntypedFilter;
  not: (col: string, op: string, value: null) => UntypedFilter;
  order: (col: string, opts: { ascending: boolean }) => UntypedFilter;
  limit: (n: number) => PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  }>;
};

type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
  };
};

export default async function PaymentsPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return <p className="text-muted-foreground p-6 text-sm">Payments are office-only.</p>;
  }

  const client = (await createClient()) as unknown as UntypedClient;

  const { data: disputes, error: disputeError } = await client
    .from("invoices")
    .select("id, number, number_label, payment_dispute_deadline")
    .eq("org_id", session.orgId)
    .eq("payment_dispute_open", true)
    .order("payment_dispute_deadline", { ascending: true })
    .limit(50);
  if (disputeError) throw new Error(disputeError.message);

  const { data: refundable, error: paymentError } = await client
    .from("payments")
    .select("id, amount_cents, status, stripe_charge_id, invoice_id")
    .eq("org_id", session.orgId)
    .eq("status", "succeeded")
    .not("stripe_charge_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(25);
  if (paymentError) throw new Error(paymentError.message);

  const canRefund = session.orgRole === "owner" || session.orgRole === "admin";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-muted-foreground text-sm">
          Open disputes show evidence deadlines. Refunds confirm only after Stripe webhooks.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Open disputes</h2>
        {(disputes ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No open payment disputes.</p>
        ) : (
          (disputes ?? []).map((invoice) => (
            <DisputeFlag
              key={String(invoice.id)}
              invoiceId={String(invoice.id)}
              invoiceLabel={
                typeof invoice.number_label === "string"
                  ? invoice.number_label
                  : invoice.number != null
                    ? `Invoice ${Number(invoice.number)}`
                    : "Invoice"
              }
              deadline={
                invoice.payment_dispute_deadline == null
                  ? null
                  : String(invoice.payment_dispute_deadline)
              }
            />
          ))
        )}
      </section>

      {canRefund ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Refund via Stripe</h2>
          {(refundable ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No succeeded card/ACH payments to refund.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(refundable ?? []).map((payment) => (
                <li
                  key={String(payment.id)}
                  className="flex items-center justify-between gap-3 border-b py-2 text-sm"
                >
                  <span>
                    {(Number(payment.amount_cents) / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}{" "}
                    · {String(payment.stripe_charge_id)}
                  </span>
                  <RefundButton paymentId={String(payment.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
