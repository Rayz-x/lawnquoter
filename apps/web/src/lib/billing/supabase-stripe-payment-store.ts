import "server-only";

import { achPaymentFailedMessage } from "@/lib/email/ach-payment-failed";
import { createEmailProvider } from "@/lib/email/provider";
import type { createAdminClient } from "@/lib/supabase/server";
import type { PaymentUpsert, PaymentWebhookStore } from "./stripe-payment-webhook";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Ledger tables are ahead of generated database.types.ts. */
type UntypedFilter = {
  eq: (col: string, value: string) => UntypedFilter & PromiseLike<{ error: { message: string; code?: string } | null }>;
  in: (
    col: string,
    values: string[],
  ) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string; code?: string } | null }>;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }>;
  single: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }>;
};

type UntypedAdmin = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
    insert: (values: Record<string, unknown>) => {
      select: (cols: string) => UntypedFilter;
    };
    update: (values: Record<string, unknown>) => UntypedFilter;
  };
};

function paymentRow(row: PaymentUpsert) {
  return {
    org_id: row.orgId,
    account_id: row.accountId,
    invoice_id: row.invoiceId,
    amount_cents: row.amountCents,
    currency: row.currency,
    status: row.status,
    stripe_payment_intent_id: row.stripePaymentIntentId,
    stripe_checkout_session_id: row.stripeCheckoutSessionId,
    stripe_charge_id: row.stripeChargeId,
    card_brand: row.cardBrand,
    card_last4: row.cardLast4,
    received_at: row.receivedAt,
  };
}

export function createStripePaymentWebhookStore(
  admin: AdminClient,
  send: ReturnType<typeof createEmailProvider>["send"] = (message) => createEmailProvider().send(message),
): PaymentWebhookStore {
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

    async findInvoiceById(invoiceId) {
      const { data, error } = await client
        .from("invoices")
        .select("id, org_id, account_id, status, total_cents, currency, number")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        orgId: String(data.org_id),
        accountId: String(data.account_id),
        status: String(data.status),
        totalCents: Number(data.total_cents),
        currency: String(data.currency),
        number: data.number == null ? null : Number(data.number),
      };
    },

    async upsertPayment(row) {
      if (row.stripePaymentIntentId) {
        const { data: existing, error: findError } = await client
          .from("payments")
          .select("id")
          .eq("stripe_payment_intent_id", row.stripePaymentIntentId)
          .maybeSingle();
        if (findError) throw new Error(findError.message);
        if (existing?.id) {
          const { error } = await client.from("payments").update(paymentRow(row)).eq("id", String(existing.id));
          if (error) throw new Error(error.message);
          return { id: String(existing.id) };
        }
      }
      const { data, error } = await client.from("payments").insert(paymentRow(row)).select("id").single();
      if (error) throw new Error(error.message);
      return { id: String(data?.id) };
    },

    async markInvoicePaid(invoiceId) {
      const { error } = await client
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", invoiceId)
        .eq("status", "issued");
      if (error) throw new Error(error.message);
    },

    async reopenInvoice(invoiceId) {
      const { error } = await client
        .from("invoices")
        .update({ status: "issued", paid_at: null })
        .eq("id", invoiceId);
      if (error) throw new Error(error.message);
    },

    async alertOfficeAchFailed(input) {
      const { data: org, error: orgError } = await admin
        .from("orgs")
        .select("name, email")
        .eq("id", input.orgId)
        .maybeSingle();
      if (orgError) throw new Error(orgError.message);

      const { data: members, error: memberError } = await client
        .from("memberships")
        .select("profiles:user_id(email), role")
        .eq("org_id", input.orgId)
        .in("role", ["owner", "admin"]);
      if (memberError) throw new Error(memberError.message);

      const emails = new Set<string>();
      if (typeof org?.email === "string" && org.email.includes("@")) emails.add(org.email.trim());
      for (const row of members ?? []) {
        const profile = row.profiles as { email?: string | null } | null;
        const email = profile?.email?.trim();
        if (email && email.includes("@")) emails.add(email);
      }

      const orgName = typeof org?.name === "string" ? org.name : "Lawnquoter";
      for (const to of emails) {
        await send(
          achPaymentFailedMessage({
            to,
            orgName,
            invoiceNumber: input.invoiceNumber,
            amountCents: input.amountCents,
            stripePaymentIntentId: input.stripePaymentIntentId,
          }),
        );
      }
    },
  };
}
