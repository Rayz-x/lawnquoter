import { describe, expect, it, vi } from "vitest";
import type { ReminderInvoice } from "./payment-reminders";
import { runPaymentRemindersJob, type PaymentReminderStore } from "./run-payment-reminders";

describe("runPaymentRemindersJob", () => {
  it("sends only during the company 7 AM hour and skips already-claimed reminders", async () => {
    const invoices: ReminderInvoice[] = [
      {
        id: "inv-1",
        orgId: "org-1",
        accountId: "acct-1",
        accountName: "Pat",
        dueOn: "2026-10-10",
        status: "issued",
        numberLabel: "INV-2026-0001",
        totalCents: 5000,
        billingEmail: "pat@example.com",
        publicToken: null,
        paymentDisputeOpen: false,
        promiseToPayUntil: null,
        collectionsFlaggedAt: null,
      },
    ];
    const claims: string[] = [];
    const store: PaymentReminderStore = {
      async listOrgs() {
        return [
          {
            id: "org-1",
            name: "Lawn Co",
            timezone: "America/Chicago",
            email: "office@lawn.co",
          },
        ];
      },
      async listIssuedInvoices() {
        return invoices;
      },
      async claimReminder(invoiceId, _orgId, stage, reminderOn) {
        const key = `${invoiceId}:${stage}:${reminderOn}`;
        if (claims.includes(key)) return false;
        claims.push(key);
        return true;
      },
      async flagAccountCollections() {
        return false;
      },
    };
    const send = vi.fn(async () => ({ id: "1", sent: true }));

    // 2026-10-10 12:00 UTC = 7:00 America/Chicago (CDT).
    const atSeven = new Date("2026-10-10T12:00:00.000Z");
    const first = await runPaymentRemindersJob({ store, now: atSeven, send });
    expect(first.orgsConsidered).toBe(1);
    expect(first.remindersSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    const second = await runPaymentRemindersJob({ store, now: atSeven, send });
    expect(second.remindersSent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);

    const atEight = new Date("2026-10-10T13:00:00.000Z");
    const offHour = await runPaymentRemindersJob({ store, now: atEight, send });
    expect(offHour.orgsConsidered).toBe(0);
  });
});
