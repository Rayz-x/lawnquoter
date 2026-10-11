import type { EmailProvider, OutboundEmail } from "@/lib/email/provider";

/** Reminder cadence: due day, then +7 and +14. Late fees are intentionally off. */
export const PAYMENT_REMINDER_STAGES = ["due", "plus_7", "plus_14"] as const;

export type PaymentReminderStage = (typeof PAYMENT_REMINDER_STAGES)[number];

export type ReminderInvoice = {
  id: string;
  orgId: string;
  accountId: string;
  accountName: string;
  dueOn: string;
  status: string;
  numberLabel: string | null;
  totalCents: number;
  billingEmail: string | null;
  /** Present once I05 lands; reminders work without it. */
  publicToken: string | null;
  paymentDisputeOpen: boolean;
  /** Inclusive pause window; null means no promise-to-pay. */
  promiseToPayUntil: string | null;
  collectionsFlaggedAt: string | null;
};

export type SelectedPaymentReminder = {
  invoice: ReminderInvoice;
  stage: PaymentReminderStage;
};

export type ReminderSendKey = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

function calendarDaysBetween(from: string, to: string): number | null {
  const fromMs = parseUtcDate(from);
  const toMs = parseUtcDate(to);
  if (fromMs === null || toMs === null) return null;
  return Math.round((toMs - fromMs) / DAY_MS);
}

/** Exact-day stage for an invoice due date relative to asOfDate. */
export function reminderStageForDueOn(
  dueOn: string,
  asOfDate: string,
): PaymentReminderStage | null {
  const days = calendarDaysBetween(dueOn, asOfDate);
  if (days === 0) return "due";
  if (days === 7) return "plus_7";
  if (days === 14) return "plus_14";
  return null;
}

export function isPaymentReminderPaused(
  invoice: Pick<ReminderInvoice, "paymentDisputeOpen" | "promiseToPayUntil">,
  asOfDate: string,
): boolean {
  if (invoice.paymentDisputeOpen) return true;
  const until = invoice.promiseToPayUntil;
  if (!until) return false;
  if (!parseUtcDate(until) || !parseUtcDate(asOfDate)) return false;
  return until >= asOfDate;
}

/** Issued invoices whose due date hits due / +7 / +14 today, excluding paused. */
export function selectPaymentReminders(
  invoices: ReminderInvoice[],
  asOfDate: string,
): SelectedPaymentReminder[] {
  const selected: SelectedPaymentReminder[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== "issued") continue;
    if (!invoice.dueOn) continue;
    if (isPaymentReminderPaused(invoice, asOfDate)) continue;
    const stage = reminderStageForDueOn(invoice.dueOn, asOfDate);
    if (!stage) continue;
    selected.push({ invoice, stage });
  }
  return selected;
}

export function reminderSendKey(
  invoiceId: string,
  stage: PaymentReminderStage,
): ReminderSendKey {
  return `${invoiceId}:${stage}`;
}

export function invoicePublicPath(publicToken: string | null | undefined): string | null {
  const token = publicToken?.trim();
  if (!token) return null;
  return `/i/${token}`;
}

function stageCopy(stage: PaymentReminderStage): string {
  if (stage === "due") return "is due today";
  if (stage === "plus_7") return "was due 7 days ago";
  return "was due 14 days ago";
}

export function paymentReminderMessage(input: {
  to: string;
  orgName: string;
  invoice: ReminderInvoice;
  stage: PaymentReminderStage;
  appBaseUrl: string;
}): OutboundEmail {
  const label = input.invoice.numberLabel?.trim() || "your invoice";
  const amount = (Math.max(0, input.invoice.totalCents) / 100).toFixed(2);
  const path = invoicePublicPath(input.invoice.publicToken);
  const base = input.appBaseUrl.replace(/\/$/, "");
  const linkLine = path ? `\n\nView invoice: ${base}${path}` : "";
  const text = `This is a payment reminder from ${input.orgName}.

Invoice ${label} for $${amount} ${stageCopy(input.stage)} (due ${input.invoice.dueOn}).${linkLine}

Late fees are not applied.
`;
  return {
    to: input.to,
    subject: `Payment reminder: ${label} — ${input.orgName}`,
    text,
  };
}

export function officeCollectionsFlagMessage(input: {
  to: string;
  orgName: string;
  accountName: string;
  accountId: string;
  invoices: ReminderInvoice[];
  asOfDate: string;
}): OutboundEmail {
  const lines = input.invoices.map((inv) => {
    const label = inv.numberLabel?.trim() || inv.id;
    return `- ${label} (due ${inv.dueOn})`;
  });
  const text = `Account flagged for collections follow-up (${input.orgName}).

Account: ${input.accountName} (${input.accountId})
As of: ${input.asOfDate}

Unpaid invoices at +14:
${lines.join("\n")}
`;
  return {
    to: input.to,
    subject: `Collections flag: ${input.accountName} — ${input.orgName}`,
    text,
  };
}

/**
 * Send due/+7/+14 reminders for the as-of date; after +14, flag each account once
 * and notify the office email when present.
 */
export async function sendPaymentReminders(input: {
  invoices: ReminderInvoice[];
  asOfDate: string;
  orgName: string;
  orgEmail: string | null;
  appBaseUrl: string;
  send: EmailProvider["send"];
  claim: (invoiceId: string, stage: PaymentReminderStage, reminderOn: string) => Promise<boolean>;
  flagAccount: (accountId: string) => Promise<boolean>;
}): Promise<{ remindersSent: number; remindersSkipped: number; accountsFlagged: number }> {
  const selected = selectPaymentReminders(input.invoices, input.asOfDate);
  let remindersSent = 0;
  let remindersSkipped = 0;
  let accountsFlagged = 0;

  const plus14ByAccount = new Map<string, ReminderInvoice[]>();

  for (const { invoice, stage } of selected) {
    if (stage === "plus_14") {
      const list = plus14ByAccount.get(invoice.accountId) ?? [];
      list.push(invoice);
      plus14ByAccount.set(invoice.accountId, list);
    }

    const to = invoice.billingEmail?.trim();
    if (!to) {
      remindersSkipped += 1;
      continue;
    }
    const claimed = await input.claim(invoice.id, stage, input.asOfDate);
    if (!claimed) {
      remindersSkipped += 1;
      continue;
    }
    const result = await input.send(
      paymentReminderMessage({
        to,
        orgName: input.orgName,
        invoice,
        stage,
        appBaseUrl: input.appBaseUrl,
      }),
    );
    if (result.sent) remindersSent += 1;
    else remindersSkipped += 1;
  }

  for (const [accountId, invoices] of plus14ByAccount) {
    const already = invoices.some((inv) => inv.collectionsFlaggedAt);
    if (already) continue;
    const flagged = await input.flagAccount(accountId);
    if (!flagged) continue;
    accountsFlagged += 1;
    const office = input.orgEmail?.trim();
    if (!office) continue;
    await input.send(
      officeCollectionsFlagMessage({
        to: office,
        orgName: input.orgName,
        accountName: invoices[0]?.accountName ?? accountId,
        accountId,
        invoices,
        asOfDate: input.asOfDate,
      }),
    );
  }

  return { remindersSent, remindersSkipped, accountsFlagged };
}
