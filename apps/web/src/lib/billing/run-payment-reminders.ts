import { createEmailProvider } from "@/lib/email/provider";
import { isCompanyDigestHour } from "@/lib/leads/follow-up-digest";
import { orgToday } from "@/lib/scheduling/office-date";
import {
  sendPaymentReminders,
  type PaymentReminderStage,
  type ReminderInvoice,
} from "./payment-reminders";

export type ReminderOrg = {
  id: string;
  name: string;
  timezone: string | null;
  email: string | null;
};

export type PaymentReminderStore = {
  listOrgs(): Promise<ReminderOrg[]>;
  listIssuedInvoices(orgId: string): Promise<ReminderInvoice[]>;
  claimReminder(
    invoiceId: string,
    orgId: string,
    stage: PaymentReminderStage,
    reminderOn: string,
  ): Promise<boolean>;
  flagAccountCollections(accountId: string, orgId: string): Promise<boolean>;
};

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * For each org in the 7 AM company-time window, send due/+7/+14 payment
 * reminders and flag accounts once after +14.
 */
export async function runPaymentRemindersJob(input: {
  store: PaymentReminderStore;
  now?: Date;
  send?: ReturnType<typeof createEmailProvider>["send"];
}): Promise<{
  orgsConsidered: number;
  remindersSent: number;
  remindersSkipped: number;
  accountsFlagged: number;
}> {
  const now = input.now ?? new Date();
  const provider = createEmailProvider();
  const send = input.send ?? ((message) => provider.send(message));
  const orgs = await input.store.listOrgs();
  let orgsConsidered = 0;
  let remindersSent = 0;
  let remindersSkipped = 0;
  let accountsFlagged = 0;

  for (const org of orgs) {
    if (!isCompanyDigestHour(org.timezone, now)) continue;
    orgsConsidered += 1;
    const asOfDate = orgToday(org.timezone, now);
    const invoices = await input.store.listIssuedInvoices(org.id);
    const result = await sendPaymentReminders({
      invoices,
      asOfDate,
      orgName: org.name,
      orgEmail: org.email,
      appBaseUrl: appBaseUrl(),
      send,
      claim: (invoiceId, stage, reminderOn) =>
        input.store.claimReminder(invoiceId, org.id, stage, reminderOn),
      flagAccount: (accountId) => input.store.flagAccountCollections(accountId, org.id),
    });
    remindersSent += result.remindersSent;
    remindersSkipped += result.remindersSkipped;
    accountsFlagged += result.accountsFlagged;
  }

  return { orgsConsidered, remindersSent, remindersSkipped, accountsFlagged };
}
