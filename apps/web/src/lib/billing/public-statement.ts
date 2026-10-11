import { reconcileStatementClosing } from "./statement";

export type PublicStatementOrg = {
  name: string;
  phone: string | null;
  email: string | null;
  brand_color: string | null;
};

export type PublicStatementLine = {
  kind: "invoice" | "payment" | "credit";
  id: string;
  on: string;
  amount_cents: number;
  label: string;
};

export type PublicAccountStatement = {
  account_id: string;
  account_name: string;
  from: string;
  to: string;
  opening_cents: number;
  invoice_cents: number;
  payment_cents: number;
  credit_cents: number;
  closing_cents: number;
  lines: PublicStatementLine[];
  org: PublicStatementOrg;
};

function asCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function asDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

/** Narrow `account_statement_public` JSON; coerces cents that arrive as strings. */
export function isPublicAccountStatement(value: unknown): value is PublicAccountStatement {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const opening = asCents(o.opening_cents);
  const invoices = asCents(o.invoice_cents);
  const payments = asCents(o.payment_cents);
  const credits = asCents(o.credit_cents);
  const closing = asCents(o.closing_cents);
  const from = asDate(o.from);
  const to = asDate(o.to);
  if (
    opening == null ||
    invoices == null ||
    payments == null ||
    credits == null ||
    closing == null ||
    from == null ||
    to == null ||
    typeof o.account_id !== "string" ||
    typeof o.account_name !== "string" ||
    !o.org ||
    typeof o.org !== "object" ||
    typeof (o.org as { name?: unknown }).name !== "string" ||
    !Array.isArray(o.lines)
  ) {
    return false;
  }

  const expected = reconcileStatementClosing({
    openingCents: opening,
    invoiceCents: invoices,
    paymentCents: payments,
    creditCents: credits,
  });
  if (closing !== expected) return false;

  o.opening_cents = opening;
  o.invoice_cents = invoices;
  o.payment_cents = payments;
  o.credit_cents = credits;
  o.closing_cents = closing;
  o.from = from;
  o.to = to;
  return true;
}
