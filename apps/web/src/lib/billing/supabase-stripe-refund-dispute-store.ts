import "server-only";

import type { createAdminClient } from "@/lib/supabase/server";
import type { RefundDisputePayment, RefundDisputeStore } from "./stripe-refund-dispute-webhook";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Ledger / dispute columns are ahead of generated database.types.ts. */
type UntypedFilter = {
  eq: (
    col: string,
    value: string | boolean,
  ) => UntypedFilter & PromiseLike<{ error: { message: string; code?: string } | null }>;
  limit: (n: number) => UntypedFilter;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }>;
};

type UntypedAdmin = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
    insert: (values: Record<string, unknown>) => PromiseLike<{
      error: { message: string; code?: string } | null;
    }> & {
      select: (cols: string) => UntypedFilter;
    };
    update: (values: Record<string, unknown>) => UntypedFilter;
  };
};

function mapPayment(data: Record<string, unknown>): RefundDisputePayment {
  return {
    id: String(data.id),
    orgId: String(data.org_id),
    accountId: String(data.account_id),
    invoiceId: data.invoice_id == null ? null : String(data.invoice_id),
    status: String(data.status),
    stripeChargeId: data.stripe_charge_id == null ? null : String(data.stripe_charge_id),
    stripePaymentIntentId:
      data.stripe_payment_intent_id == null ? null : String(data.stripe_payment_intent_id),
    stripeRefundId: data.stripe_refund_id == null ? null : String(data.stripe_refund_id),
  };
}

export function createStripeRefundDisputeStore(admin: AdminClient): RefundDisputeStore {
  const client = admin as unknown as UntypedAdmin;

  return {
    async claimEvent(eventId, eventType, orgId, payload) {
      const { data, error } = await client
        .from("stripe_events")
        .insert({
          stripe_event_id: eventId,
          event_type: eventType,
          org_id: orgId,
          payload: payload ?? {},
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return { claimed: false };
        throw new Error(error.message);
      }
      return { claimed: Boolean(data) };
    },

    async findPaymentByChargeId(chargeId) {
      const { data, error } = await client
        .from("payments")
        .select(
          "id, org_id, account_id, invoice_id, status, stripe_charge_id, stripe_payment_intent_id, stripe_refund_id",
        )
        .eq("stripe_charge_id", chargeId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapPayment(data) : null;
    },

    async findPaymentByPaymentIntentId(paymentIntentId) {
      const { data, error } = await client
        .from("payments")
        .select(
          "id, org_id, account_id, invoice_id, status, stripe_charge_id, stripe_payment_intent_id, stripe_refund_id",
        )
        .eq("stripe_payment_intent_id", paymentIntentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapPayment(data) : null;
    },

    async markPaymentRefunded(input) {
      const { data: existing, error: findError } = await client
        .from("payments")
        .select("id, status, stripe_refund_id, org_id, invoice_id")
        .eq("id", input.paymentId)
        .maybeSingle();
      if (findError) throw new Error(findError.message);
      if (!existing) return { recorded: false };
      if (String(existing.status) === "refunded") return { recorded: false };

      const { error } = await client
        .from("payments")
        .update({
          status: "refunded",
          stripe_refund_id: input.stripeRefundId,
        })
        .eq("id", input.paymentId);
      if (error) throw new Error(error.message);

      if (existing.org_id) {
        const { error: eventError } = await client.from("billing_events").insert({
          org_id: existing.org_id,
          invoice_id: existing.invoice_id,
          payment_id: input.paymentId,
          kind: "payment.refunded",
          payload: {
            stripe_refund_id: input.stripeRefundId,
            amount_cents: input.amountCents,
          },
        });
        if (eventError) throw new Error(eventError.message);
      }

      return { recorded: true };
    },

    async flagDispute(input) {
      const { error: invError } = await client
        .from("invoices")
        .update({
          payment_dispute_open: true,
          payment_dispute_deadline: input.deadline,
          stripe_dispute_id: input.stripeDisputeId,
        })
        .eq("id", input.invoiceId);
      if (invError) throw new Error(invError.message);

      const { error: acctError } = await client
        .from("accounts")
        .update({ payment_dispute_open: true })
        .eq("id", input.accountId);
      if (acctError) throw new Error(acctError.message);

      const { error: eventError } = await client.from("billing_events").insert({
        org_id: input.orgId,
        invoice_id: input.invoiceId,
        kind: "payment.dispute_opened",
        payload: {
          stripe_dispute_id: input.stripeDisputeId,
          deadline: input.deadline,
          account_id: input.accountId,
        },
      });
      if (eventError) throw new Error(eventError.message);
    },

    async clearDispute(input) {
      const { error: invError } = await client
        .from("invoices")
        .update({
          payment_dispute_open: false,
          payment_dispute_deadline: null,
          stripe_dispute_id: null,
        })
        .eq("id", input.invoiceId)
        .eq("stripe_dispute_id", input.stripeDisputeId);
      if (invError) throw new Error(invError.message);

      const { data: openInvoice, error: openError } = await client
        .from("invoices")
        .select("id")
        .eq("account_id", input.accountId)
        .eq("payment_dispute_open", true)
        .limit(1)
        .maybeSingle();
      if (openError) throw new Error(openError.message);

      if (!openInvoice) {
        const { error: acctError } = await client
          .from("accounts")
          .update({ payment_dispute_open: false })
          .eq("id", input.accountId);
        if (acctError) throw new Error(acctError.message);
      }

      const { data: invoice, error: invReadError } = await client
        .from("invoices")
        .select("org_id")
        .eq("id", input.invoiceId)
        .maybeSingle();
      if (invReadError) throw new Error(invReadError.message);

      if (invoice?.org_id) {
        const { error: eventError } = await client.from("billing_events").insert({
          org_id: invoice.org_id,
          invoice_id: input.invoiceId,
          kind: "payment.dispute_closed",
          payload: {
            stripe_dispute_id: input.stripeDisputeId,
            account_id: input.accountId,
          },
        });
        if (eventError) throw new Error(eventError.message);
      }
    },
  };
}
