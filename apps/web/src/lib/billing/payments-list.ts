export const PAYMENT_LIST_STATUSES = ["pending", "succeeded", "failed", "refunded"] as const;
export type PaymentListStatus = (typeof PAYMENT_LIST_STATUSES)[number];

export const PAYMENT_LIST_METHODS = ["stripe", "cash", "check", "account_credit"] as const;
export type PaymentListMethod = (typeof PAYMENT_LIST_METHODS)[number];

export type PaymentListRow = {
  id: string;
  status: string;
  method: string | null;
  amountCents: number;
  receivedAt: string | null;
  accountId?: string;
  accountName?: string | null;
  invoiceId?: string | null;
};

export function filterPayments(
  rows: PaymentListRow[],
  filters: { status?: string; method?: string },
): PaymentListRow[] {
  const status = filters.status?.trim() || "";
  const method = filters.method?.trim() || "";
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (method && (row.method ?? "") !== method) return false;
    return true;
  });
}

export function isPaymentListStatus(value: string | undefined): value is PaymentListStatus {
  return PAYMENT_LIST_STATUSES.includes(value as PaymentListStatus);
}

export function isPaymentListMethod(value: string | undefined): value is PaymentListMethod {
  return PAYMENT_LIST_METHODS.includes(value as PaymentListMethod);
}
