import { describe, expect, it, vi } from "vitest";
import { QBO_NOT_CONNECTED } from "./qbo";
import {
  createQboCustomerClient,
  createQboLedgerClient,
  qboDollars,
  syncQboLedger,
  type QboLedgerClient,
  type QboLedgerInvoice,
  type QboLedgerLink,
  type QboLedgerPayment,
  type QboLedgerStore,
  type QboRemoteInvoice,
  type QboRemotePayment,
} from "./qbo-ledger";

const SYNCED = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-04T00:00:00.000Z";
const REMOTE_LATER = "2026-10-03T00:00:00.000Z";

function keysOn() {
  process.env.QBO_CLIENT_ID = "id";
  process.env.QBO_CLIENT_SECRET = "secret";
}

function keysOff() {
  delete process.env.QBO_CLIENT_ID;
  delete process.env.QBO_CLIENT_SECRET;
}

function invoice(overrides: Partial<QboLedgerInvoice> = {}): QboLedgerInvoice {
  return {
    id: "inv-1",
    accountId: "acct-1",
    numberLabel: "INV-2026-0004",
    status: "issued",
    totalCents: 4000,
    issuedAt: "2026-10-01",
    updatedAt: LATER,
    ...overrides,
  };
}

function accountLink(overrides: Partial<QboLedgerLink> = {}): QboLedgerLink {
  return { localTable: "accounts", localId: "acct-1", qboId: "42", syncToken: "0", lastSyncedAt: SYNCED, remoteUpdatedAt: SYNCED, ...overrides };
}

function memory(seed: { invoices?: QboLedgerInvoice[]; payments?: QboLedgerPayment[]; links?: QboLedgerLink[] }) {
  const conflicts: { localId: string; localName: string; remoteName: string }[] = [];
  const linksSaved: unknown[] = [];
  const logs: { detail: string; outcome: string; direction: string; entity: string }[] = [];
  const applied: { invoiceId: string; amountCents: number; receivedAt: string | null }[] = [];
  const store: QboLedgerStore = {
    invoices: async () => seed.invoices ?? [],
    payments: async () => seed.payments ?? [],
    links: async () => seed.links ?? [],
    saveLink: async (input) => {
      linksSaved.push(input);
    },
    saveConflict: async (input) => {
      conflicts.push(input);
    },
    log: async (input) => {
      logs.push(input);
    },
    applyPulledPayment: async (input) => {
      applied.push(input);
      return { id: "pay-new" };
    },
  };
  return { store, conflicts, linksSaved, logs, applied };
}

function client(remote?: { invoices?: QboRemoteInvoice[]; payments?: QboRemotePayment[] }) {
  const invoices: unknown[] = [];
  const voids: { qboId: string; syncToken: string }[] = [];
  const payments: unknown[] = [];
  const refunds: unknown[] = [];
  const ledger: QboLedgerClient = {
    upsertInvoice: async (body) => {
      invoices.push(body);
      return { id: "77", syncToken: "1" };
    },
    voidInvoice: async (qboId, syncToken) => {
      voids.push({ qboId, syncToken });
    },
    upsertPayment: async (body) => {
      payments.push(body);
      return { id: "88", syncToken: "1" };
    },
    pushRefund: async (body) => {
      refunds.push(body);
      return { id: "89", syncToken: "0" };
    },
    listInvoices: async () => remote?.invoices ?? [],
    listPayments: async () => remote?.payments ?? [],
  };
  return { ledger, invoices, voids, payments, refunds };
}

describe("QuickBooks invoice and payment sync", () => {
  it("converts cents to dollars", () => {
    expect(qboDollars(4000)).toBe(40);
    expect(qboDollars(8333)).toBe(83.33);
  });

  it("does not sync until the QuickBooks keys are set", async () => {
    keysOff();
    const calls = { n: 0 };
    const { store } = memory({});
    const ledger: QboLedgerClient = {
      upsertInvoice: async () => {
        calls.n += 1;
        return { id: "1", syncToken: "0" };
      },
      voidInvoice: async () => {
        calls.n += 1;
      },
      upsertPayment: async () => {
        calls.n += 1;
        return { id: "1", syncToken: "0" };
      },
      pushRefund: async () => {
        calls.n += 1;
        return { id: "1", syncToken: "0" };
      },
      listInvoices: async () => {
        calls.n += 1;
        return [];
      },
      listPayments: async () => {
        calls.n += 1;
        return [];
      },
    };
    expect(await syncQboLedger(store, ledger)).toEqual({ error: QBO_NOT_CONNECTED });
    expect(calls.n).toBe(0);
  });

  it("pushes an issued invoice as dollars against the QuickBooks customer", async () => {
    keysOn();
    const { store } = memory({ invoices: [invoice(), invoice({ id: "draft", status: "draft", numberLabel: "INV-2026-0009" })], links: [accountLink()] });
    const recorded = client();
    const result = await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(result).toEqual({ pushed: 1, pulled: 0, conflicts: 0 });
    expect(recorded.invoices).toEqual([
      {
        CustomerRef: { value: "42" },
        DocNumber: "INV-2026-0004",
        TxnDate: "2026-10-01",
        Line: [{ Amount: 40, Description: "INV-2026-0004", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 40 } }],
      },
    ]);
  });

  it("voids a linked invoice and does not upsert it", async () => {
    keysOn();
    const { store } = memory({
      invoices: [invoice({ status: "void", updatedAt: LATER })],
      links: [accountLink(), { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "3", lastSyncedAt: SYNCED, remoteUpdatedAt: SYNCED }],
    });
    const recorded = client();
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(recorded.voids).toEqual([{ qboId: "77", syncToken: "3" }]);
    expect(recorded.invoices).toEqual([]);
  });

  it("pushes a payment against the QuickBooks invoice", async () => {
    keysOn();
    const { store } = memory({
      invoices: [invoice({ status: "paid", updatedAt: SYNCED })],
      payments: [{ id: "pay-1", invoiceId: "inv-1", amountCents: 4000, status: "succeeded", receivedAt: "2026-10-02", updatedAt: LATER }],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: LATER, remoteUpdatedAt: SYNCED },
      ],
    });
    const recorded = client();
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(recorded.invoices).toEqual([]);
    expect(recorded.payments).toEqual([
      {
        TotalAmt: 40,
        TxnDate: "2026-10-02",
        CustomerRef: { value: "42" },
        Line: [{ Amount: 40, LinkedTxn: [{ TxnId: "77", TxnType: "Invoice" }] }],
      },
    ]);
  });

  it("pushes a refund for a payment that is already in QuickBooks", async () => {
    keysOn();
    const { store } = memory({
      invoices: [invoice({ status: "paid", updatedAt: SYNCED })],
      payments: [{ id: "pay-1", invoiceId: "inv-1", amountCents: 4000, status: "refunded", receivedAt: "2026-10-02", updatedAt: LATER }],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: LATER, remoteUpdatedAt: SYNCED },
        { localTable: "payments", localId: "pay-1", qboId: "88", syncToken: "1", lastSyncedAt: SYNCED, remoteUpdatedAt: SYNCED },
      ],
    });
    const recorded = client();
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(recorded.payments).toEqual([]);
    expect(recorded.refunds).toEqual([{ TotalAmt: 40, CustomerRef: { value: "42" }, Line: [{ Amount: 40, LinkedTxn: [{ TxnId: "88", TxnType: "Payment" }] }] }]);
  });

  it("records a conflict and does not upsert when both sides of an invoice changed", async () => {
    keysOn();
    const { store, conflicts } = memory({
      invoices: [invoice({ updatedAt: LATER })],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: SYNCED, remoteUpdatedAt: REMOTE_LATER },
      ],
    });
    const recorded = client();
    const result = await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(result).toEqual({ pushed: 0, pulled: 0, conflicts: 1 });
    expect(conflicts).toEqual([{ localId: "inv-1", localName: "INV-2026-0004", remoteName: "INV-2026-0004" }]);
    expect(recorded.invoices).toEqual([]);
  });

  it("links a remote change without overwriting the issued invoice", async () => {
    keysOn();
    const { store, linksSaved } = memory({
      invoices: [invoice({ updatedAt: SYNCED })],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: SYNCED, remoteUpdatedAt: SYNCED },
      ],
    });
    const recorded = client({
      invoices: [{ id: "77", syncToken: "4", docNumber: "INV-2026-0004", totalCents: 4000, updatedAt: REMOTE_LATER }],
    });
    const result = await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(result).toEqual({ pushed: 0, pulled: 1, conflicts: 0 });
    expect(recorded.invoices).toEqual([]);
    expect(linksSaved).toEqual([{ localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "4", remoteUpdatedAt: REMOTE_LATER }]);
  });

  it("does not create a local invoice for an unknown QuickBooks number", async () => {
    keysOn();
    const { store, linksSaved, logs } = memory({ invoices: [], links: [] });
    const recorded = client({ invoices: [{ id: "9", syncToken: "0", docNumber: "INV-2026-9999", totalCents: 100, updatedAt: REMOTE_LATER }] });
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(linksSaved).toEqual([]);
    expect(logs).toContainEqual({ direction: "pull", entity: "Invoice", localId: null, qboId: "9", outcome: "skipped", detail: "No local invoice" });
  });

  it("records a QuickBooks payment that has no local match", async () => {
    keysOn();
    const { store, applied, linksSaved } = memory({
      invoices: [invoice({ updatedAt: SYNCED })],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: LATER, remoteUpdatedAt: SYNCED },
      ],
    });
    const recorded = client({
      payments: [{ id: "55", syncToken: "0", totalCents: 2500, txnDate: "2026-10-02", updatedAt: REMOTE_LATER, invoiceQboId: "77" }],
    });
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(applied).toEqual([{ invoiceId: "inv-1", amountCents: 2500, receivedAt: "2026-10-02" }]);
    expect(linksSaved).toContainEqual({ localTable: "payments", localId: "pay-new", qboId: "55", syncToken: "0", remoteUpdatedAt: REMOTE_LATER });
  });

  it("does not record a second payment when that QuickBooks id is already linked", async () => {
    keysOn();
    const { store, applied } = memory({
      invoices: [invoice({ updatedAt: SYNCED })],
      payments: [{ id: "pay-1", invoiceId: "inv-1", amountCents: 2500, status: "succeeded", receivedAt: "2026-10-02", updatedAt: SYNCED }],
      links: [
        accountLink(),
        { localTable: "invoices", localId: "inv-1", qboId: "77", syncToken: "1", lastSyncedAt: LATER, remoteUpdatedAt: SYNCED },
        { localTable: "payments", localId: "pay-1", qboId: "55", syncToken: "0", lastSyncedAt: LATER, remoteUpdatedAt: SYNCED },
      ],
    });
    const recorded = client({
      payments: [{ id: "55", syncToken: "0", totalCents: 2500, txnDate: "2026-10-02", updatedAt: SYNCED, invoiceQboId: "77" }],
    });
    await syncQboLedger(store, recorded.ledger);
    keysOff();
    expect(applied).toEqual([]);
    expect(recorded.payments).toEqual([]);
  });
});

describe("QuickBooks HTTP client", () => {
  it("posts an invoice to the company with minorversion 75 and the Services item", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("query")) {
        return new Response(JSON.stringify({ QueryResponse: { Item: [{ Id: "1", Name: "Services" }] } }), { status: 200 });
      }
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ Invoice: { Id: "77", SyncToken: "0" } }), { status: 200 });
    });
    const ledger = createQboLedgerClient({ realmId: "999", accessToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    const saved = await ledger.upsertInvoice(
      {
        CustomerRef: { value: "42" },
        DocNumber: "INV-2026-0004",
        TxnDate: "2026-10-01",
        Line: [{ Amount: 40, Description: "INV-2026-0004", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 40 } }],
      },
      null,
    );
    expect(saved).toEqual({ id: "77", syncToken: "0" });
    const invoiceUrl = String(fetchImpl.mock.calls[1]?.[0]);
    expect(invoiceUrl).toBe("https://quickbooks.api.intuit.com/v3/company/999/invoice?minorversion=75");
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer tok" } });
    expect(bodies[0]).toMatchObject({ Line: [{ SalesItemLineDetail: { ItemRef: { value: "1" }, UnitPrice: 40 } }] });
  });

  it("voids with the invoice operation and reads a 25 dollar payment as 2500 cents", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("operation=void")) return new Response(JSON.stringify({ Invoice: { Id: "77", SyncToken: "4" } }), { status: 200 });
      return new Response(
        JSON.stringify({
          QueryResponse: {
            Payment: [
              {
                Id: "55",
                SyncToken: "0",
                TotalAmt: 25,
                TxnDate: "2026-10-02",
                MetaData: { LastUpdatedTime: REMOTE_LATER },
                Line: [{ Amount: 25, LinkedTxn: [{ TxnId: "77", TxnType: "Invoice" }] }],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const ledger = createQboLedgerClient({ realmId: "999", accessToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    await ledger.voidInvoice("77", "3");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://quickbooks.api.intuit.com/v3/company/999/invoice?operation=void&minorversion=75");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ Id: "77", SyncToken: "3" });
    expect(await ledger.listPayments()).toEqual([
      { id: "55", syncToken: "0", totalCents: 2500, txnDate: "2026-10-02", updatedAt: REMOTE_LATER, invoiceQboId: "77" },
    ]);
  });

  it("posts a customer with the accounting minorversion", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ Customer: { Id: "42", SyncToken: "0", DisplayName: "Parent Co" } }), { status: 200 }));
    const customers = createQboCustomerClient({ realmId: "999", accessToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await customers.upsertCustomer({ DisplayName: "Parent Co", Job: false }, null)).toEqual({ id: "42", syncToken: "0" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://quickbooks.api.intuit.com/v3/company/999/customer?minorversion=75");
  });
});
