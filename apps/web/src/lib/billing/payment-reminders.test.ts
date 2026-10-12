import { describe, expect, it, vi } from "vitest";
import {
  invoicePublicPath,
  isPaymentReminderPaused,
  paymentReminderMessage,
  paymentReminderText,
  reminderSendKey,
  reminderStageForDueOn,
  selectPaymentReminders,
  sendPaymentReminders,
  type ReminderInvoice,
} from "./payment-reminders";

function invoice(
  partial: Partial<ReminderInvoice> & Pick<ReminderInvoice, "id">,
): ReminderInvoice {
  return {
    orgId: "org-1",
    accountId: "acct-1",
    accountName: "Pat Home",
    dueOn: "2026-10-10",
    status: "issued",
    numberLabel: "INV-2026-0001",
    totalCents: 12500,
    billingEmail: "pat@example.com",
    publicToken: "tok-abc",
    paymentDisputeOpen: false,
    promiseToPayUntil: null,
    collectionsFlaggedAt: null,
    ...partial,
  };
}

describe("reminderStageForDueOn", () => {
  it("maps due, +7, and +14 calendar days; other days null", () => {
    expect(reminderStageForDueOn("2026-10-10", "2026-10-10")).toBe("due");
    expect(reminderStageForDueOn("2026-10-10", "2026-10-17")).toBe("plus_7");
    expect(reminderStageForDueOn("2026-10-10", "2026-10-24")).toBe("plus_14");
    expect(reminderStageForDueOn("2026-10-10", "2026-10-11")).toBeNull();
    expect(reminderStageForDueOn("2026-10-10", "2026-10-16")).toBeNull();
  });
});

describe("selectPaymentReminders", () => {
  it("returns exactly the reminders due for the given date", () => {
    const asOf = "2026-10-17";
    const rows = [
      invoice({ id: "due-today", dueOn: "2026-10-17" }),
      invoice({ id: "plus-7", dueOn: "2026-10-10" }),
      invoice({ id: "plus-14", dueOn: "2026-10-03" }),
      invoice({ id: "other-day", dueOn: "2026-10-11" }),
      invoice({ id: "paid", dueOn: "2026-10-10", status: "paid" }),
      invoice({ id: "void", dueOn: "2026-10-10", status: "void" }),
      invoice({ id: "draft", dueOn: "2026-10-10", status: "draft" }),
    ];

    const selected = selectPaymentReminders(rows, asOf);
    expect(
      selected.map((row) => `${row.invoice.id}:${row.stage}`).sort(),
    ).toEqual(["due-today:due", "plus-14:plus_14", "plus-7:plus_7"]);
  });

  it("suppresses reminders when disputed or promise-to-pay is active", () => {
    const asOf = "2026-10-10";
    const rows = [
      invoice({ id: "ok", dueOn: "2026-10-10" }),
      invoice({ id: "disputed", dueOn: "2026-10-10", paymentDisputeOpen: true }),
      invoice({
        id: "promise",
        dueOn: "2026-10-10",
        promiseToPayUntil: "2026-10-15",
      }),
      invoice({
        id: "promise-expired",
        dueOn: "2026-10-10",
        promiseToPayUntil: "2026-10-09",
      }),
    ];

    expect(isPaymentReminderPaused(rows[1]!, asOf)).toBe(true);
    expect(isPaymentReminderPaused(rows[2]!, asOf)).toBe(true);
    expect(isPaymentReminderPaused(rows[3]!, asOf)).toBe(false);

    const selected = selectPaymentReminders(rows, asOf);
    expect(selected.map((row) => row.invoice.id).sort()).toEqual([
      "ok",
      "promise-expired",
    ]);
  });
});

describe("sendPaymentReminders", () => {
  it("sends once per invoice stage and flags the account once after +14", async () => {
    const asOf = "2026-10-24";
    const rows = [
      invoice({
        id: "inv-a",
        dueOn: "2026-10-10",
        accountId: "acct-a",
        billingEmail: "a@example.com",
      }),
      invoice({
        id: "inv-b",
        dueOn: "2026-10-10",
        accountId: "acct-a",
        billingEmail: "a@example.com",
        numberLabel: "INV-2026-0002",
      }),
    ];
    const sentKeys = new Set<string>();
    const flaggedAccounts = new Set<string>();
    const send = vi.fn(async () => ({ id: "msg", sent: true }));
    const claim = vi.fn(async (invoiceId: string, stage: string) => {
      const key = reminderSendKey(invoiceId, stage as "due" | "plus_7" | "plus_14");
      if (sentKeys.has(key)) return false;
      sentKeys.add(key);
      return true;
    });
    const flagAccount = vi.fn(async (accountId: string) => {
      if (flaggedAccounts.has(accountId)) return false;
      flaggedAccounts.add(accountId);
      return true;
    });

    const first = await sendPaymentReminders({
      invoices: rows,
      asOfDate: asOf,
      orgName: "Lawn Co",
      orgEmail: "office@lawn.co",
      appBaseUrl: "https://app.example",
      send,
      claim,
      flagAccount,
    });
    expect(first.remindersSent).toBe(2);
    expect(first.accountsFlagged).toBe(1);
    expect(send).toHaveBeenCalled();
    // Two customer reminders + one office flag notice.
    expect(send).toHaveBeenCalledTimes(3);
    expect(flagAccount).toHaveBeenCalledTimes(1);

    const second = await sendPaymentReminders({
      invoices: rows,
      asOfDate: asOf,
      orgName: "Lawn Co",
      orgEmail: "office@lawn.co",
      appBaseUrl: "https://app.example",
      send,
      claim,
      flagAccount,
    });
    expect(second.remindersSent).toBe(0);
    expect(second.accountsFlagged).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("invoicePublicPath", () => {
  it("uses the public token when present, otherwise omits a path", () => {
    expect(invoicePublicPath("tok-abc")).toBe("/i/tok-abc");
    expect(invoicePublicPath(null)).toBeNull();
    expect(invoicePublicPath("")).toBeNull();
  });
});

describe("payment reminder texts", () => {
  it("texts an opted-in number in the same claim as email, and skips a number that never agreed", async () => {
    const row = invoice({
      id: "inv-sms",
      dueOn: "2026-10-10",
      billingEmail: "pat@example.com",
      smsPhone: "5551110000",
      smsOptIn: true,
      publicToken: "tok-sms",
    });
    const send = vi.fn(async () => ({ id: "email", sent: true }));
    const sendText = vi.fn(async () => ({ sent: true }));
    const claim = vi.fn(async () => true);
    const flagAccount = vi.fn(async () => false);
    const result = await sendPaymentReminders({
      invoices: [row],
      asOfDate: "2026-10-10",
      orgName: "North Lawn",
      orgEmail: null,
      appBaseUrl: "https://app.example",
      send,
      sendText,
      claim,
      flagAccount,
    });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith({
      to: "+15551110000",
      body: "Hi Pat Home, a reminder from North Lawn about $125.00: https://app.example/i/tok-sms It is due today.",
      from: null,
      invoiceId: "inv-sms",
      orgId: "org-1",
      accountId: "acct-1",
    });
    expect(result.remindersTexted).toBe(1);

    sendText.mockClear();
    claim.mockClear();
    await sendPaymentReminders({
      invoices: [invoice({ id: "inv-no", dueOn: "2026-10-10", billingEmail: null, smsPhone: "5551110000", smsOptIn: false })],
      asOfDate: "2026-10-10",
      orgName: "North Lawn",
      orgEmail: null,
      appBaseUrl: "https://app.example",
      send,
      sendText,
      claim,
      flagAccount,
    });
    expect(claim).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(paymentReminderText({
      invoice: invoice({ id: "inv-no", smsPhone: "5551110000", smsOptIn: false }),
      stage: "due",
      orgName: "North Lawn",
      appBaseUrl: "https://app.example",
    })).toBeNull();
    expect(paymentReminderText({
      invoice: invoice({ id: "inv-nolink", smsPhone: "5551110000", smsOptIn: true, publicToken: null }),
      stage: "due",
      orgName: "North Lawn",
      appBaseUrl: "https://app.example",
    })).toBeNull();
  });
});

describe("paymentReminderMessage", () => {
  it("includes invoice label and optional public link", () => {
    const withLink = paymentReminderMessage({
      to: "pat@example.com",
      orgName: "Lawn Co",
      invoice: invoice({ id: "1", publicToken: "tok-1" }),
      stage: "due",
      appBaseUrl: "https://app.example",
    });
    expect(withLink.subject).toContain("INV-2026-0001");
    expect(withLink.text).toContain("https://app.example/i/tok-1");

    const noToken = paymentReminderMessage({
      to: "pat@example.com",
      orgName: "Lawn Co",
      invoice: invoice({ id: "1", publicToken: null }),
      stage: "plus_7",
      appBaseUrl: "https://app.example",
    });
    expect(noToken.text).not.toContain("/i/");
  });
});
