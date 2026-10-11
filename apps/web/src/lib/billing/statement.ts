export type StatementInvoice = {
  id: string;
  issuedOn: string;
  totalCents: number;
  number?: number | null;
};

export type StatementPayment = {
  id: string;
  receivedOn: string;
  amountCents: number;
  method?: string | null;
};

export type StatementCredit = {
  id: string;
  issuedOn: string;
  amountCents: number;
  reason?: string | null;
};

export type StatementLine =
  | { kind: "invoice"; id: string; on: string; amountCents: number; label: string }
  | { kind: "payment"; id: string; on: string; amountCents: number; label: string }
  | { kind: "credit"; id: string; on: string; amountCents: number; label: string };

export type AccountStatement = {
  from: string;
  to: string;
  openingCents: number;
  invoiceCents: number;
  paymentCents: number;
  creditCents: number;
  closingCents: number;
  lines: StatementLine[];
};

export function reconcileStatementClosing(input: {
  openingCents: number;
  invoiceCents: number;
  paymentCents: number;
  creditCents: number;
}): number {
  return (
    Math.trunc(input.openingCents) +
    Math.trunc(input.invoiceCents) -
    Math.trunc(input.paymentCents) -
    Math.trunc(input.creditCents)
  );
}

function onOrAfter(date: string, from: string): boolean {
  return date >= from;
}

function onOrBefore(date: string, to: string): boolean {
  return date <= to;
}

function inPeriod(date: string, from: string, to: string): boolean {
  return onOrAfter(date, from) && onOrBefore(date, to);
}

function beforePeriod(date: string, from: string): boolean {
  return date < from;
}

/** Build a period statement from ledger rows. Dates are YYYY-MM-DD. */
export function buildAccountStatement(input: {
  from: string;
  to: string;
  invoices: StatementInvoice[];
  payments: StatementPayment[];
  credits: StatementCredit[];
}): AccountStatement {
  const { from, to } = input;

  let openingInvoices = 0;
  let openingPayments = 0;
  let openingCredits = 0;
  let invoiceCents = 0;
  let paymentCents = 0;
  let creditCents = 0;
  const lines: StatementLine[] = [];

  for (const invoice of input.invoices) {
    const amount = Math.max(0, Math.trunc(invoice.totalCents));
    if (beforePeriod(invoice.issuedOn, from)) {
      openingInvoices += amount;
    } else if (inPeriod(invoice.issuedOn, from, to)) {
      invoiceCents += amount;
      lines.push({
        kind: "invoice",
        id: invoice.id,
        on: invoice.issuedOn,
        amountCents: amount,
        label: invoice.number != null ? `Invoice #${invoice.number}` : "Invoice",
      });
    }
  }

  for (const payment of input.payments) {
    const amount = Math.max(0, Math.trunc(payment.amountCents));
    if (beforePeriod(payment.receivedOn, from)) {
      openingPayments += amount;
    } else if (inPeriod(payment.receivedOn, from, to)) {
      paymentCents += amount;
      lines.push({
        kind: "payment",
        id: payment.id,
        on: payment.receivedOn,
        amountCents: amount,
        label: payment.method ? `Payment (${payment.method})` : "Payment",
      });
    }
  }

  for (const credit of input.credits) {
    const amount = Math.max(0, Math.trunc(credit.amountCents));
    if (beforePeriod(credit.issuedOn, from)) {
      openingCredits += amount;
    } else if (inPeriod(credit.issuedOn, from, to)) {
      creditCents += amount;
      lines.push({
        kind: "credit",
        id: credit.id,
        on: credit.issuedOn,
        amountCents: amount,
        label: credit.reason?.trim() ? `Credit — ${credit.reason.trim()}` : "Credit",
      });
    }
  }

  lines.sort((a, b) => (a.on === b.on ? a.id.localeCompare(b.id) : a.on.localeCompare(b.on)));

  const openingCents = openingInvoices - openingPayments - openingCredits;
  const closingCents = reconcileStatementClosing({
    openingCents,
    invoiceCents,
    paymentCents,
    creditCents,
  });

  return {
    from,
    to,
    openingCents,
    invoiceCents,
    paymentCents,
    creditCents,
    closingCents,
    lines,
  };
}
