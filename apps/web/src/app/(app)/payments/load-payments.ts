import { openInvoiceBalanceCents, sumAgingBuckets, type OpenInvoiceForAging } from "@/lib/billing/aging";
import {
  filterPayments,
  isPaymentListMethod,
  isPaymentListStatus,
  type PaymentListRow,
} from "@/lib/billing/payments-list";

type LooseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options?: { ascending?: boolean },
        ) => {
          limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

export async function loadPaymentsPageData(
  supabase: LooseClient,
  orgId: string,
  filters: { status?: string; method?: string },
  asOf: string,
) {
  const [paymentsResult, invoicesResult, creditNotesResult, accountsResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id, amount_cents, status, method, received_at, created_at, account_id, invoice_id, accounts(name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("invoices")
      .select("id, status, due_on, total_cents, account_id")
      .eq("org_id", orgId)
      .order("issued_at", { ascending: false })
      .limit(1000),
    supabase
      .from("credit_notes")
      .select("id, invoice_id, amount_cents")
      .eq("org_id", orgId)
      .order("issued_at", { ascending: false })
      .limit(1000),
    supabase.from("accounts").select("id, name").eq("org_id", orgId).order("name").limit(500),
  ]);

  const paymentRows = Array.isArray(paymentsResult.data) ? paymentsResult.data : [];
  const invoiceRows = Array.isArray(invoicesResult.data) ? invoicesResult.data : [];
  const creditRows = Array.isArray(creditNotesResult.data) ? creditNotesResult.data : [];
  const accountRows = Array.isArray(accountsResult.data) ? accountsResult.data : [];

  const paymentsByInvoice = new Map<string, number>();
  for (const raw of paymentRows) {
    const row = raw as Record<string, unknown>;
    if (row.status !== "succeeded" || typeof row.invoice_id !== "string") continue;
    paymentsByInvoice.set(
      row.invoice_id,
      (paymentsByInvoice.get(row.invoice_id) ?? 0) + asNumber(row.amount_cents),
    );
  }

  const creditsByInvoice = new Map<string, number>();
  for (const raw of creditRows) {
    const row = raw as Record<string, unknown>;
    if (typeof row.invoice_id !== "string") continue;
    creditsByInvoice.set(
      row.invoice_id,
      (creditsByInvoice.get(row.invoice_id) ?? 0) + asNumber(row.amount_cents),
    );
  }

  const openInvoices: OpenInvoiceForAging[] = invoiceRows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const id = String(row.id);
    return {
      id,
      status: String(row.status ?? ""),
      dueOn: dateOnly(row.due_on),
      totalCents: asNumber(row.total_cents),
      paymentCents: paymentsByInvoice.get(id) ?? 0,
      creditNoteCents: creditsByInvoice.get(id) ?? 0,
    };
  });

  const aging = sumAgingBuckets(openInvoices, asOf);

  const allPayments: PaymentListRow[] = paymentRows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const accounts = row.accounts as { name?: string } | null;
    return {
      id: String(row.id),
      status: String(row.status ?? ""),
      method: typeof row.method === "string" ? row.method : null,
      amountCents: asNumber(row.amount_cents),
      receivedAt:
        typeof row.received_at === "string"
          ? row.received_at
          : typeof row.created_at === "string"
            ? row.created_at
            : null,
      accountId: typeof row.account_id === "string" ? row.account_id : undefined,
      accountName: accounts?.name ?? null,
      invoiceId: typeof row.invoice_id === "string" ? row.invoice_id : null,
    };
  });

  const status = isPaymentListStatus(filters.status) ? filters.status : undefined;
  const method = isPaymentListMethod(filters.method) ? filters.method : undefined;
  const payments = filterPayments(allPayments, { status, method });

  const accounts = accountRows
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return { id: String(row.id), name: String(row.name ?? "Account") };
    })
    .filter((a) => a.id);

  const openArCheck = openInvoices
    .filter((i) => i.status === "issued")
    .reduce((sum, i) => sum + openInvoiceBalanceCents(i), 0);

  return {
    aging,
    openArCheck,
    payments,
    accounts,
    error:
      paymentsResult.error?.message ||
      invoicesResult.error?.message ||
      creditNotesResult.error?.message ||
      accountsResult.error?.message ||
      null,
    status,
    method,
  };
}
