import "server-only";

import type { QboAccount, QboLink, QboSyncStore } from "@/lib/billing/qbo";
import type { QboLedgerInvoice, QboLedgerLink, QboLedgerPayment, QboLedgerStore } from "@/lib/billing/qbo-ledger";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

function must<T>(error: { message: string } | null, data: T): T {
  if (error) throw new Error(error.message);
  return data;
}

export function createQboCustomerStore(admin: AdminClient, orgId: string): QboSyncStore {
  return {
    async accounts() {
      const { data, error } = await admin.from("accounts").select("id, name, parent_account_id, updated_at").eq("org_id", orgId);
      const rows = must(error, data ?? []);
      return rows.map(
        (row): QboAccount => ({
          id: row.id,
          name: row.name,
          parentAccountId: row.parent_account_id,
          updatedAt: row.updated_at,
        }),
      );
    },
    async links() {
      const { data, error } = await admin
        .from("qbo_entity_links")
        .select("local_id, qbo_id, sync_token, last_synced_at, remote_updated_at")
        .eq("org_id", orgId)
        .eq("local_table", "accounts");
      const rows = must(error, data ?? []);
      return rows.map(
        (row): QboLink => ({
          localId: row.local_id,
          qboId: row.qbo_id,
          syncToken: row.sync_token,
          lastSyncedAt: row.last_synced_at,
          remoteUpdatedAt: row.remote_updated_at,
        }),
      );
    },
    async saveLink(input) {
      const { error } = await admin.from("qbo_entity_links").upsert(
        {
          org_id: orgId,
          local_table: "accounts",
          local_id: input.localId,
          qbo_entity: "Customer",
          qbo_id: input.qboId,
          sync_token: input.syncToken,
          parent_qbo_id: input.parentQboId,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "org_id,local_table,local_id" },
      );
      if (error) throw new Error(error.message);
    },
    async saveConflict(input) {
      await insertConflict(admin, orgId, "accounts", input);
    },
    async log(input) {
      await insertLog(admin, orgId, { direction: "push", entity: "Customer", localId: input.localId, qboId: input.qboId, outcome: input.outcome, detail: input.detail });
    },
  };
}

export function createQboLedgerStore(admin: AdminClient, orgId: string): QboLedgerStore {
  return {
    async invoices() {
      const { data, error } = await admin
        .from("invoices")
        .select("id, account_id, number_label, status, total_cents, issued_at, updated_at")
        .eq("org_id", orgId)
        .in("status", ["issued", "paid", "void"]);
      const rows = must(error, data ?? []);
      return rows.flatMap((row): QboLedgerInvoice[] => {
        if (row.status !== "issued" && row.status !== "paid" && row.status !== "void") return [];
        return [
          {
            id: row.id,
            accountId: row.account_id,
            numberLabel: row.number_label,
            status: row.status,
            totalCents: row.total_cents,
            issuedAt: row.issued_at,
            updatedAt: row.updated_at,
          },
        ];
      });
    },
    async payments() {
      const { data, error } = await admin
        .from("payments")
        .select("id, invoice_id, amount_cents, status, received_at, updated_at")
        .eq("org_id", orgId)
        .in("status", ["succeeded", "refunded"])
        .not("invoice_id", "is", null);
      const rows = must(error, data ?? []);
      return rows.flatMap((row): QboLedgerPayment[] => {
        if (!row.invoice_id) return [];
        if (row.status !== "succeeded" && row.status !== "refunded") return [];
        return [
          {
            id: row.id,
            invoiceId: row.invoice_id,
            amountCents: row.amount_cents,
            status: row.status,
            receivedAt: row.received_at,
            updatedAt: row.updated_at,
          },
        ];
      });
    },
    async links() {
      const { data, error } = await admin
        .from("qbo_entity_links")
        .select("local_table, local_id, qbo_id, sync_token, last_synced_at, remote_updated_at")
        .eq("org_id", orgId);
      const rows = must(error, data ?? []);
      return rows.flatMap((row): QboLedgerLink[] => {
        if (row.local_table !== "accounts" && row.local_table !== "invoices" && row.local_table !== "payments") return [];
        return [
          {
            localTable: row.local_table,
            localId: row.local_id,
            qboId: row.qbo_id,
            syncToken: row.sync_token,
            lastSyncedAt: row.last_synced_at,
            remoteUpdatedAt: row.remote_updated_at,
          },
        ];
      });
    },
    async saveLink(input) {
      const { error } = await admin.from("qbo_entity_links").upsert(
        {
          org_id: orgId,
          local_table: input.localTable,
          local_id: input.localId,
          qbo_entity: input.localTable === "invoices" ? "Invoice" : "Payment",
          qbo_id: input.qboId,
          sync_token: input.syncToken,
          remote_updated_at: input.remoteUpdatedAt,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "org_id,local_table,local_id" },
      );
      if (error) throw new Error(error.message);
    },
    async saveConflict(input) {
      await insertConflict(admin, orgId, null, input);
    },
    async log(input) {
      await insertLog(admin, orgId, input);
    },
    async applyPulledPayment(input) {
      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .select("id, account_id, currency, status, total_cents")
        .eq("org_id", orgId)
        .eq("id", input.invoiceId)
        .maybeSingle();
      if (invoiceError) throw new Error(invoiceError.message);
      if (!invoice) throw new Error("invoice not found");
      const { data: payment, error: paymentError } = await admin
        .from("payments")
        .insert({
          org_id: orgId,
          account_id: invoice.account_id,
          invoice_id: invoice.id,
          amount_cents: input.amountCents,
          currency: invoice.currency,
          status: "succeeded",
          method: "check",
          note: "Came from QuickBooks",
          received_at: input.receivedAt,
        })
        .select("id")
        .single();
      if (paymentError) throw new Error(paymentError.message);
      const { error: eventError } = await admin.from("billing_events").insert({
        org_id: orgId,
        invoice_id: invoice.id,
        payment_id: payment.id,
        kind: "payment.qbo_pulled",
        payload: { amount_cents: input.amountCents, note: "Came from QuickBooks" },
      });
      if (eventError) throw new Error(eventError.message);
      if (invoice.status === "issued") {
        const { data: balance, error: balanceError } = await admin.rpc("invoice_balance_cents", { p_invoice_id: invoice.id });
        if (balanceError) throw new Error(balanceError.message);
        if (balance === 0) {
          const { error: paidError } = await admin
            .from("invoices")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("org_id", orgId)
            .eq("id", invoice.id);
          if (paidError) throw new Error(paidError.message);
        }
      }
      return { id: payment.id };
    },
  };
}

async function insertLog(
  admin: AdminClient,
  orgId: string,
  input: { direction: "push" | "pull"; entity: string; localId: string | null; qboId: string | null; outcome: string; detail: string },
) {
  const { error } = await admin.from("qbo_sync_log").insert({
    org_id: orgId,
    direction: input.direction,
    entity: input.entity,
    local_id: input.localId,
    qbo_id: input.qboId,
    outcome: input.outcome,
    detail: input.detail,
  });
  if (error) throw new Error(error.message);
}

async function insertConflict(
  admin: AdminClient,
  orgId: string,
  localTable: "accounts" | null,
  input: { localId: string; localName: string; remoteName: string },
) {
  let lookup = admin.from("qbo_entity_links").select("id").eq("org_id", orgId).eq("local_id", input.localId);
  if (localTable) lookup = lookup.eq("local_table", localTable);
  const { data: link, error: linkError } = await lookup.maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (link) {
    const { data: open, error: openError } = await admin
      .from("qbo_conflicts")
      .select("id")
      .eq("org_id", orgId)
      .eq("link_id", link.id)
      .eq("status", "open")
      .maybeSingle();
    if (openError) throw new Error(openError.message);
    if (open) return;
  }
  const { error } = await admin.from("qbo_conflicts").insert({
    org_id: orgId,
    link_id: link?.id ?? null,
    local_name: input.localName,
    remote_name: input.remoteName,
    status: "open",
  });
  if (error) throw new Error(error.message);
}
