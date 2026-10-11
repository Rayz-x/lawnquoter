import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { PaymentReminderStage, ReminderInvoice } from "./payment-reminders";
import type { PaymentReminderStore, ReminderOrg } from "./run-payment-reminders";

type AdminClient = ReturnType<typeof createAdminClient>;

type UntypedAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => Promise<{
        data: Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
      }> & {
        eq: (
          col2: string,
          value2: string,
        ) => Promise<{
          data: Record<string, unknown>[] | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function isMissingRelation(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message.toLowerCase();
  return (
    error.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("schema cache")
  );
}

/**
 * Production store for I10 payment reminders. Soft-fails to [] when ledger /
 * pause columns are not migrated yet.
 */
export function createSupabasePaymentRemindersStore(
  admin: AdminClient = createAdminClient(),
): PaymentReminderStore {
  const client = admin as unknown as UntypedAdmin;

  return {
    async listOrgs(): Promise<ReminderOrg[]> {
      const { data, error } = await admin.from("orgs").select("id, name, timezone, email");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        timezone: row.timezone,
        email: row.email,
      }));
    },

    async listIssuedInvoices(orgId: string): Promise<ReminderInvoice[]> {
      const { data, error } = await client
        .from("invoices")
        .select(
          "id, org_id, account_id, due_on, status, number_label, total_cents, public_token, accounts(name, email, billing_email, payment_dispute_open, promise_to_pay_until, collections_flagged_at)",
        )
        .eq("org_id", orgId)
        .eq("status", "issued");

      if (error) {
        if (isMissingRelation(error)) return [];
        // Retry without public_token / pause columns when I05 / this migration
        // has not landed yet.
        const fallback = await client
          .from("invoices")
          .select(
            "id, org_id, account_id, due_on, status, number_label, total_cents, accounts(name, email, billing_email)",
          )
          .eq("org_id", orgId)
          .eq("status", "issued");
        if (fallback.error) {
          if (isMissingRelation(fallback.error)) return [];
          throw new Error(fallback.error.message);
        }
        return (fallback.data ?? []).map((row) => mapInvoiceRow(row, true));
      }

      return (data ?? []).map((row) => mapInvoiceRow(row, false));
    },

    async claimReminder(invoiceId, orgId, stage, reminderOn): Promise<boolean> {
      const { data, error } = await client.rpc("claim_invoice_payment_reminder", {
        p_invoice_id: invoiceId,
        p_org_id: orgId,
        p_stage: stage,
        p_reminder_on: reminderOn,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },

    async flagAccountCollections(accountId, orgId): Promise<boolean> {
      const { data, error } = await client.rpc("flag_account_collections", {
        p_account_id: accountId,
        p_org_id: orgId,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

function mapInvoiceRow(row: Record<string, unknown>, legacy: boolean): ReminderInvoice {
  const account = row.accounts as Record<string, unknown> | null;
  const billing =
    (account?.billing_email as string | null | undefined)?.trim() ||
    (account?.email as string | null | undefined)?.trim() ||
    null;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    accountId: String(row.account_id),
    accountName: String(account?.name ?? "Account"),
    dueOn: row.due_on ? String(row.due_on).slice(0, 10) : "",
    status: String(row.status ?? "issued"),
    numberLabel: row.number_label ? String(row.number_label) : null,
    totalCents: Number(row.total_cents ?? 0),
    billingEmail: billing,
    publicToken: legacy ? null : row.public_token ? String(row.public_token) : null,
    paymentDisputeOpen: legacy ? false : Boolean(account?.payment_dispute_open),
    promiseToPayUntil: legacy
      ? null
      : account?.promise_to_pay_until
        ? String(account.promise_to_pay_until).slice(0, 10)
        : null,
    collectionsFlaggedAt: legacy
      ? null
      : account?.collections_flagged_at
        ? String(account.collections_flagged_at)
        : null,
  };
}
