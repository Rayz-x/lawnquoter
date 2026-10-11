import "server-only";

import { isPayEnabled, type ConnectStatus } from "@/lib/stripe/connect";
import type { createAdminClient } from "@/lib/supabase/server";
import type { CheckoutInvoice } from "./stripe-checkout";

type AdminClient = ReturnType<typeof createAdminClient>;

type UntypedAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPublicInvoiceToken(token: string): boolean {
  return UUID_RE.test(token);
}

export async function loadCheckoutContext(
  admin: AdminClient,
  token: string,
): Promise<
  | { ok: true; invoice: CheckoutInvoice; stripeAccountId: string }
  | { ok: false; reason: "not_found" | "connect_not_ready" }
> {
  if (!isPublicInvoiceToken(token)) return { ok: false, reason: "not_found" };

  const client = admin as unknown as UntypedAdmin;
  const { data: invoice, error } = await client
    .from("invoices")
    .select("id, org_id, account_id, number, number_label, status, currency, total_cents, public_token")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) return { ok: false, reason: "not_found" };

  const { data: connect, error: connectError } = await admin
    .from("org_stripe_connect")
    .select("stripe_account_id, status")
    .eq("org_id", String(invoice.org_id))
    .maybeSingle();
  if (connectError) throw new Error(connectError.message);

  const status = (connect?.status ?? "not_connected") as ConnectStatus;
  const accountId = connect?.stripe_account_id ?? null;
  if (!accountId || !isPayEnabled(status)) {
    return { ok: false, reason: "connect_not_ready" };
  }

  return {
    ok: true,
    stripeAccountId: accountId,
    invoice: {
      id: String(invoice.id),
      orgId: String(invoice.org_id),
      accountId: String(invoice.account_id),
      number: invoice.number == null ? null : Number(invoice.number),
      numberLabel: typeof invoice.number_label === "string" ? invoice.number_label : null,
      status: String(invoice.status),
      currency: String(invoice.currency),
      totalCents: Number(invoice.total_cents),
      publicToken: String(invoice.public_token),
    },
  };
}
