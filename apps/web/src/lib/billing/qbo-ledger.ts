import { QBO_NOT_CONNECTED, qboConflict, qboConfigured, type QboCustomerBody, type QboCustomerClient } from "./qbo";

// Invoice and payment sync. Off until QBO_CLIENT_ID and QBO_CLIENT_SECRET are set.

const MINOR_VERSION = "75";
const API_ROOT = "https://quickbooks.api.intuit.com/v3/company";

/** 4000 cents is 40 dollars. 8333 cents is 83.33 dollars. */
export function qboDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function qboCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export type QboInvoiceBody = {
  CustomerRef: { value: string };
  DocNumber: string;
  TxnDate: string;
  Line: Array<{
    Amount: number;
    Description: string;
    DetailType: "SalesItemLineDetail";
    SalesItemLineDetail: { Qty: number; UnitPrice: number; ItemRef?: { value: string } };
  }>;
};

export type QboPaymentBody = {
  TotalAmt: number;
  TxnDate: string;
  CustomerRef: { value: string };
  Line: Array<{ Amount: number; LinkedTxn: Array<{ TxnId: string; TxnType: "Invoice" }> }>;
};

export type QboRefundBody = {
  TotalAmt: number;
  CustomerRef?: { value: string };
  Line: Array<{ Amount: number; LinkedTxn: Array<{ TxnId: string; TxnType: "Payment" }> }>;
};

export function qboInvoiceBody(input: { customerQboId: string; numberLabel: string; txnDate: string; totalCents: number }): QboInvoiceBody {
  const amount = qboDollars(input.totalCents);
  return {
    CustomerRef: { value: input.customerQboId },
    DocNumber: input.numberLabel,
    TxnDate: input.txnDate,
    Line: [
      {
        Amount: amount,
        Description: input.numberLabel,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { Qty: 1, UnitPrice: amount },
      },
    ],
  };
}

export function qboPaymentBody(input: { totalCents: number; txnDate: string; invoiceQboId: string; customerQboId: string }): QboPaymentBody {
  const amount = qboDollars(input.totalCents);
  return {
    TotalAmt: amount,
    TxnDate: input.txnDate,
    CustomerRef: { value: input.customerQboId },
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: input.invoiceQboId, TxnType: "Invoice" }] }],
  };
}

export function qboRefundBody(input: { totalCents: number; paymentQboId: string; customerQboId: string | null }): QboRefundBody {
  const amount = qboDollars(input.totalCents);
  return {
    TotalAmt: amount,
    ...(input.customerQboId ? { CustomerRef: { value: input.customerQboId } } : {}),
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: input.paymentQboId, TxnType: "Payment" }] }],
  };
}

export type QboLedgerInvoice = {
  id: string;
  accountId: string;
  numberLabel: string | null;
  status: "draft" | "issued" | "paid" | "void";
  totalCents: number;
  issuedAt: string | null;
  updatedAt: string;
};

export type QboLedgerPayment = {
  id: string;
  invoiceId: string;
  amountCents: number;
  status: "succeeded" | "refunded";
  receivedAt: string | null;
  updatedAt: string;
};

export type QboLedgerLink = {
  localTable: "accounts" | "invoices" | "payments";
  localId: string;
  qboId: string;
  syncToken: string | null;
  lastSyncedAt: string | null;
  remoteUpdatedAt: string | null;
};

export type QboLedgerStore = {
  invoices(): Promise<QboLedgerInvoice[]>;
  payments(): Promise<QboLedgerPayment[]>;
  links(): Promise<QboLedgerLink[]>;
  saveLink(input: { localTable: "invoices" | "payments"; localId: string; qboId: string; syncToken: string; remoteUpdatedAt: string | null }): Promise<void>;
  saveConflict(input: { localId: string; localName: string; remoteName: string }): Promise<void>;
  log(input: { direction: "push" | "pull"; entity: "Invoice" | "Payment"; localId: string | null; qboId: string | null; outcome: string; detail: string }): Promise<void>;
  applyPulledPayment(input: { invoiceId: string; amountCents: number; receivedAt: string | null }): Promise<{ id: string }>;
};

export type QboRemoteInvoice = {
  id: string;
  syncToken: string;
  docNumber: string;
  totalCents: number;
  updatedAt: string | null;
};

export type QboRemotePayment = {
  id: string;
  syncToken: string;
  totalCents: number;
  txnDate: string | null;
  updatedAt: string | null;
  invoiceQboId: string | null;
};

export type QboIdentity = { id: string; syncToken: string | null };

export type QboLedgerClient = {
  upsertInvoice(body: QboInvoiceBody, existing: QboIdentity | null): Promise<{ id: string; syncToken: string }>;
  voidInvoice(qboId: string, syncToken: string): Promise<void>;
  upsertPayment(body: QboPaymentBody, existing: QboIdentity | null): Promise<{ id: string; syncToken: string }>;
  pushRefund(body: QboRefundBody): Promise<{ id: string; syncToken: string }>;
  listInvoices(): Promise<QboRemoteInvoice[]>;
  listPayments(): Promise<QboRemotePayment[]>;
};

function dateOnly(value: string | null | undefined, fallback: string): string {
  const source = value && value.length >= 10 ? value : fallback;
  return source.slice(0, 10);
}

function moneyName(cents: number): string {
  return qboDollars(cents).toFixed(2);
}

function localChanged(updatedAt: string, link: QboLedgerLink | undefined): boolean {
  if (!link?.lastSyncedAt) return true;
  return updatedAt > link.lastSyncedAt;
}

function indexLinks(links: QboLedgerLink[], table: QboLedgerLink["localTable"]): Map<string, QboLedgerLink> {
  return new Map(links.filter((link) => link.localTable === table).map((link) => [link.localId, link]));
}

export async function syncQboLedger(
  store: QboLedgerStore,
  client: QboLedgerClient,
): Promise<{ pushed: number; pulled: number; conflicts: number } | { error: string }> {
  if (!qboConfigured()) return { error: QBO_NOT_CONNECTED };

  const invoices = await store.invoices();
  const payments = await store.payments();
  const links = await store.links();
  const accountLinks = indexLinks(links, "accounts");
  const invoiceLinks = indexLinks(links, "invoices");
  const paymentLinks = indexLinks(links, "payments");
  const paymentByQbo = new Map(links.filter((link) => link.localTable === "payments").map((link) => [link.qboId, link]));

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;
  const conflicted = new Set<string>();
  const pushedInvoices = new Set<string>();
  const pushedPayments = new Set<string>();

  for (const invoice of invoices) {
    if (invoice.status === "draft" || !invoice.numberLabel) continue;
    const customer = accountLinks.get(invoice.accountId);
    if (!customer) {
      await store.log({ direction: "push", entity: "Invoice", localId: invoice.id, qboId: null, outcome: "skipped", detail: "No QuickBooks customer" });
      continue;
    }
    const link = invoiceLinks.get(invoice.id);
    if (link && qboConflict(invoice.updatedAt, link.remoteUpdatedAt, link.lastSyncedAt)) {
      await store.saveConflict({ localId: invoice.id, localName: invoice.numberLabel, remoteName: invoice.numberLabel });
      await store.log({ direction: "push", entity: "Invoice", localId: invoice.id, qboId: link.qboId, outcome: "conflict", detail: "Both sides changed" });
      conflicts += 1;
      conflicted.add(invoice.id);
      continue;
    }
    if (invoice.status === "void") {
      if (link?.syncToken && localChanged(invoice.updatedAt, link)) {
        await client.voidInvoice(link.qboId, link.syncToken);
        await store.log({ direction: "push", entity: "Invoice", localId: invoice.id, qboId: link.qboId, outcome: "pushed", detail: "Voided" });
        pushed += 1;
        pushedInvoices.add(invoice.id);
      } else if (!link) {
        await store.log({ direction: "push", entity: "Invoice", localId: invoice.id, qboId: null, outcome: "skipped", detail: "No QuickBooks invoice to void" });
      }
      continue;
    }
    if (link && !localChanged(invoice.updatedAt, link)) continue;
    const saved = await client.upsertInvoice(
      qboInvoiceBody({
        customerQboId: customer.qboId,
        numberLabel: invoice.numberLabel,
        txnDate: dateOnly(invoice.issuedAt, invoice.updatedAt),
        totalCents: invoice.totalCents,
      }),
      link ? { id: link.qboId, syncToken: link.syncToken } : null,
    );
    invoiceLinks.set(invoice.id, {
      localTable: "invoices",
      localId: invoice.id,
      qboId: saved.id,
      syncToken: saved.syncToken,
      lastSyncedAt: invoice.updatedAt,
      remoteUpdatedAt: link?.remoteUpdatedAt ?? null,
    });
    await store.saveLink({ localTable: "invoices", localId: invoice.id, qboId: saved.id, syncToken: saved.syncToken, remoteUpdatedAt: link?.remoteUpdatedAt ?? null });
    await store.log({ direction: "push", entity: "Invoice", localId: invoice.id, qboId: saved.id, outcome: "pushed", detail: "Invoice" });
    pushed += 1;
    pushedInvoices.add(invoice.id);
  }

  for (const payment of payments) {
    const invoice = invoices.find((row) => row.id === payment.invoiceId);
    const invoiceLink = invoiceLinks.get(payment.invoiceId);
    if (invoice?.status === "void") {
      await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: null, outcome: "skipped", detail: "Invoice is void" });
      continue;
    }
    if (!invoice || !invoiceLink) {
      await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: null, outcome: "skipped", detail: "No QuickBooks invoice" });
      continue;
    }
    const customer = accountLinks.get(invoice.accountId);
    const link = paymentLinks.get(payment.id);
    if (link && qboConflict(payment.updatedAt, link.remoteUpdatedAt, link.lastSyncedAt)) {
      const name = moneyName(payment.amountCents);
      await store.saveConflict({ localId: payment.id, localName: name, remoteName: name });
      await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: link.qboId, outcome: "conflict", detail: "Both sides changed" });
      conflicts += 1;
      continue;
    }
    if (payment.status === "refunded") {
      if (!link) {
        await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: null, outcome: "skipped", detail: "No QuickBooks payment to refund" });
        continue;
      }
      if (!localChanged(payment.updatedAt, link)) continue;
      const saved = await client.pushRefund(qboRefundBody({ totalCents: payment.amountCents, paymentQboId: link.qboId, customerQboId: customer?.qboId ?? null }));
      await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: saved.id, outcome: "pushed", detail: "Refund" });
      pushed += 1;
      pushedPayments.add(payment.id);
      continue;
    }
    if (!customer) {
      await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: null, outcome: "skipped", detail: "No QuickBooks customer" });
      continue;
    }
    if (link && !localChanged(payment.updatedAt, link)) continue;
    const saved = await client.upsertPayment(
      qboPaymentBody({
        totalCents: payment.amountCents,
        txnDate: dateOnly(payment.receivedAt, invoice.issuedAt ?? invoice.updatedAt),
        invoiceQboId: invoiceLink.qboId,
        customerQboId: customer.qboId,
      }),
      link ? { id: link.qboId, syncToken: link.syncToken } : null,
    );
    paymentByQbo.set(saved.id, {
      localTable: "payments",
      localId: payment.id,
      qboId: saved.id,
      syncToken: saved.syncToken,
      lastSyncedAt: payment.updatedAt,
      remoteUpdatedAt: link?.remoteUpdatedAt ?? null,
    });
    paymentLinks.set(payment.id, paymentByQbo.get(saved.id)!);
    await store.saveLink({ localTable: "payments", localId: payment.id, qboId: saved.id, syncToken: saved.syncToken, remoteUpdatedAt: link?.remoteUpdatedAt ?? null });
    await store.log({ direction: "push", entity: "Payment", localId: payment.id, qboId: saved.id, outcome: "pushed", detail: "Payment" });
    pushed += 1;
    pushedPayments.add(payment.id);
  }

  const byNumber = new Map(invoices.filter((invoice) => invoice.numberLabel && invoice.status !== "draft").map((invoice) => [invoice.numberLabel as string, invoice]));
  for (const remote of await client.listInvoices()) {
    const local = byNumber.get(remote.docNumber);
    if (!local) {
      await store.log({ direction: "pull", entity: "Invoice", localId: null, qboId: remote.id, outcome: "skipped", detail: "No local invoice" });
      continue;
    }
    if (pushedInvoices.has(local.id)) {
      await store.saveLink({ localTable: "invoices", localId: local.id, qboId: remote.id, syncToken: remote.syncToken, remoteUpdatedAt: remote.updatedAt });
      continue;
    }
    const link = invoiceLinks.get(local.id);
    if (link && remote.updatedAt && qboConflict(local.updatedAt, remote.updatedAt, link.lastSyncedAt)) {
      if (!conflicted.has(local.id)) {
        await store.saveConflict({ localId: local.id, localName: local.numberLabel ?? remote.docNumber, remoteName: remote.docNumber });
        await store.log({ direction: "pull", entity: "Invoice", localId: local.id, qboId: remote.id, outcome: "conflict", detail: "Both sides changed" });
        conflicts += 1;
        conflicted.add(local.id);
      }
      continue;
    }
    const remoteOnly =
      !link ||
      (remote.updatedAt != null && link.lastSyncedAt != null && remote.updatedAt > link.lastSyncedAt && !(local.updatedAt > link.lastSyncedAt));
    if (!remoteOnly) continue;
    await store.saveLink({ localTable: "invoices", localId: local.id, qboId: remote.id, syncToken: remote.syncToken, remoteUpdatedAt: remote.updatedAt });
    await store.log({ direction: "pull", entity: "Invoice", localId: local.id, qboId: remote.id, outcome: "pulled", detail: local.numberLabel ?? remote.docNumber });
    pulled += 1;
  }

  for (const remote of await client.listPayments()) {
    if (remote.totalCents <= 0 || paymentByQbo.has(remote.id)) continue;
    const invoiceLink = remote.invoiceQboId ? [...invoiceLinks.values()].find((link) => link.qboId === remote.invoiceQboId) : undefined;
    if (!invoiceLink) {
      await store.log({ direction: "pull", entity: "Payment", localId: null, qboId: remote.id, outcome: "skipped", detail: "No local invoice" });
      continue;
    }
    const match = payments.find(
      (payment) =>
        payment.invoiceId === invoiceLink.localId &&
        payment.status === "succeeded" &&
        payment.amountCents === remote.totalCents &&
        !paymentLinks.has(payment.id) &&
        !pushedPayments.has(payment.id),
    );
    const localId = match ? match.id : (await store.applyPulledPayment({ invoiceId: invoiceLink.localId, amountCents: remote.totalCents, receivedAt: remote.txnDate })).id;
    const remembered: QboLedgerLink = {
      localTable: "payments",
      localId,
      qboId: remote.id,
      syncToken: remote.syncToken,
      lastSyncedAt: remote.updatedAt,
      remoteUpdatedAt: remote.updatedAt,
    };
    paymentLinks.set(localId, remembered);
    paymentByQbo.set(remote.id, remembered);
    await store.saveLink({ localTable: "payments", localId, qboId: remote.id, syncToken: remote.syncToken, remoteUpdatedAt: remote.updatedAt });
    await store.log({ direction: "pull", entity: "Payment", localId, qboId: remote.id, outcome: "pulled", detail: "Payment" });
    pulled += 1;
  }

  return { pushed, pulled, conflicts };
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): Json[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function companyUrl(realmId: string, resource: string, params: Record<string, string>): string {
  const url = new URL(`${API_ROOT}/${realmId}/${resource}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function withIdentity<T extends object>(body: T, existing: QboIdentity | null): T & { Id?: string; SyncToken?: string } {
  if (!existing) return body;
  return { ...body, Id: existing.id, SyncToken: existing.syncToken ?? "0" };
}

function savedEntity(body: unknown, key: string): { id: string; syncToken: string } {
  const entity = isRecord(body) ? body[key] : undefined;
  if (!isRecord(entity) || typeof entity.Id !== "string") throw new Error("QuickBooks did not sync.");
  const syncToken = entity.SyncToken;
  return { id: entity.Id, syncToken: typeof syncToken === "string" ? syncToken : "0" };
}

function linkedInvoiceId(row: Json): string | null {
  for (const line of asList(row.Line)) {
    for (const txn of asList(line.LinkedTxn)) {
      if (txn.TxnType === "Invoice" && typeof txn.TxnId === "string") return txn.TxnId;
    }
  }
  return null;
}

export function createQboLedgerClient(input: { realmId: string; accessToken: string; fetchImpl: typeof fetch }): QboLedgerClient {
  let serviceItemId: string | null = null;

  async function send(method: "GET" | "POST", resource: string, params: Record<string, string>, body?: unknown): Promise<unknown> {
    const response = await input.fetchImpl(companyUrl(input.realmId, resource, params), {
      method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("QuickBooks did not sync.");
    return response.json();
  }

  async function itemId(): Promise<string> {
    if (serviceItemId) return serviceItemId;
    const payload = await send("GET", "query", { minorversion: MINOR_VERSION, query: "select * from Item where Type = 'Service' maxresults 20" });
    const rows = isRecord(payload) ? asList(isRecord(payload.QueryResponse) ? payload.QueryResponse.Item : undefined) : [];
    const match = rows.find((row) => row.Name === "Services") ?? rows[0];
    if (!match || typeof match.Id !== "string") throw new Error("QuickBooks needs a service item before invoices can sync.");
    serviceItemId = match.Id;
    return serviceItemId;
  }

  function withItem(body: QboInvoiceBody, id: string): QboInvoiceBody {
    return {
      ...body,
      Line: body.Line.map((line) => ({
        ...line,
        SalesItemLineDetail: { ...line.SalesItemLineDetail, ItemRef: { value: id } },
      })),
    };
  }

  return {
    async upsertInvoice(body, existing) {
      const posted = withItem(withIdentity(body, existing), await itemId());
      return savedEntity(await send("POST", "invoice", { minorversion: MINOR_VERSION }, posted), "Invoice");
    },
    async voidInvoice(qboId, syncToken) {
      await send("POST", "invoice", { operation: "void", minorversion: MINOR_VERSION }, { Id: qboId, SyncToken: syncToken });
    },
    async upsertPayment(body, existing) {
      return savedEntity(await send("POST", "payment", { minorversion: MINOR_VERSION }, withIdentity(body, existing)), "Payment");
    },
    async pushRefund(body) {
      const id = await itemId();
      const posted = {
        ...body,
        Line: body.Line.map((line) => ({
          ...line,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: { Qty: 1, UnitPrice: line.Amount, ItemRef: { value: id } },
        })),
      };
      return savedEntity(await send("POST", "refundreceipt", { minorversion: MINOR_VERSION }, posted), "RefundReceipt");
    },
    async listInvoices() {
      const payload = await send("GET", "query", { minorversion: MINOR_VERSION, query: "select * from Invoice" });
      const rows = isRecord(payload) && isRecord(payload.QueryResponse) ? asList(payload.QueryResponse.Invoice) : [];
      return rows.flatMap((row) => {
        if (typeof row.Id !== "string" || typeof row.DocNumber !== "string") return [];
        return [
          {
            id: row.Id,
            syncToken: typeof row.SyncToken === "string" ? row.SyncToken : "0",
            docNumber: row.DocNumber,
            totalCents: qboCents(typeof row.TotalAmt === "number" ? row.TotalAmt : 0),
            updatedAt: isRecord(row.MetaData) && typeof row.MetaData.LastUpdatedTime === "string" ? row.MetaData.LastUpdatedTime : null,
          },
        ];
      });
    },
    async listPayments() {
      const payload = await send("GET", "query", { minorversion: MINOR_VERSION, query: "select * from Payment" });
      const rows = isRecord(payload) && isRecord(payload.QueryResponse) ? asList(payload.QueryResponse.Payment) : [];
      return rows.flatMap((row) => {
        if (typeof row.Id !== "string") return [];
        return [
          {
            id: row.Id,
            syncToken: typeof row.SyncToken === "string" ? row.SyncToken : "0",
            totalCents: qboCents(typeof row.TotalAmt === "number" ? row.TotalAmt : 0),
            txnDate: typeof row.TxnDate === "string" ? row.TxnDate : null,
            updatedAt: isRecord(row.MetaData) && typeof row.MetaData.LastUpdatedTime === "string" ? row.MetaData.LastUpdatedTime : null,
            invoiceQboId: linkedInvoiceId(row),
          },
        ];
      });
    },
  };
}

export function createQboCustomerClient(input: { realmId: string; accessToken: string; fetchImpl: typeof fetch }): QboCustomerClient {
  return {
    async upsertCustomer(body: QboCustomerBody, existing) {
      const response = await input.fetchImpl(companyUrl(input.realmId, "customer", { minorversion: MINOR_VERSION }), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(withIdentity(body, existing)),
      });
      if (!response.ok) throw new Error("QuickBooks did not sync.");
      return savedEntity(await response.json(), "Customer");
    },
    async remoteName(qboId) {
      const response = await input.fetchImpl(companyUrl(input.realmId, `customer/${encodeURIComponent(qboId)}`, { minorversion: MINOR_VERSION }), {
        method: "GET",
        headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as unknown;
      if (!isRecord(payload) || !isRecord(payload.Customer) || typeof payload.Customer.DisplayName !== "string") return null;
      const updatedAt = isRecord(payload.Customer.MetaData) && typeof payload.Customer.MetaData.LastUpdatedTime === "string" ? payload.Customer.MetaData.LastUpdatedTime : null;
      return updatedAt ? { name: payload.Customer.DisplayName, updatedAt } : { name: payload.Customer.DisplayName, updatedAt: "1970-01-01T00:00:00.000Z" };
    },
  };
}
