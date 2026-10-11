import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { issuedInvoiceMessage } from "@/lib/email/issued-invoice";
import { createEmailProvider } from "@/lib/email/provider";
import type { createClient } from "@/lib/supabase/server";
import { InvoicePdf } from "@/app/i/[token]/invoice-pdf";
import type { PublicInvoice } from "./public-invoice";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
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
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function billingEmailFromAccount(account: {
  email?: string | null;
  billing_email?: string | null;
}): string | null {
  const billing = typeof account.billing_email === "string" ? account.billing_email.trim() : "";
  if (billing) return billing;
  const email = typeof account.email === "string" ? account.email.trim() : "";
  return email || null;
}

/**
 * After issue_invoice succeeds: load public payload, email billing contact with PDF + token link.
 * Returns whether one email was sent (false when no recipient or provider no-op).
 */
export async function notifyIssuedInvoice(options: {
  supabase: Supabase;
  invoiceId: string;
  orgId: string;
  appBaseUrl: string;
}): Promise<{ emailed: boolean; publicToken: string | null }> {
  const client = options.supabase as unknown as UntypedClient;
  const { data: invoice, error } = await client
    .from("invoices")
    .select("id, public_token, account_id, status")
    .eq("id", options.invoiceId)
    .eq("org_id", options.orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice || invoice.status !== "issued" || typeof invoice.public_token !== "string") {
    return { emailed: false, publicToken: null };
  }

  const { data: account, error: accountError } = await client
    .from("accounts")
    .select("email, billing_email")
    .eq("id", String(invoice.account_id))
    .eq("org_id", options.orgId)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  const to = account
    ? billingEmailFromAccount({
        email: typeof account.email === "string" ? account.email : null,
        billing_email: typeof account.billing_email === "string" ? account.billing_email : null,
      })
    : null;
  if (!to) return { emailed: false, publicToken: invoice.public_token };

  const { data, error: publicError } = await client.rpc("invoice_public", {
    p_token: invoice.public_token,
  });
  if (publicError) throw new Error(publicError.message);
  if (!data || typeof data !== "object") {
    return { emailed: false, publicToken: invoice.public_token };
  }

  const payload = data as PublicInvoice;
  const base = options.appBaseUrl.replace(/\/$/, "");
  const invoiceUrl = `${base}/i/${invoice.public_token}`;
  const pdf = await renderToBuffer(
    InvoicePdf({
      payload,
      invoiceUrl,
    }),
  );

  const result = await createEmailProvider().send(
    issuedInvoiceMessage({
      to,
      orgName: payload.org.name,
      numberLabel: payload.number_label ?? `Invoice ${payload.number ?? ""}`.trim(),
      invoiceUrl,
      pdf: Buffer.from(pdf),
    }),
  );

  return { emailed: result.sent, publicToken: invoice.public_token };
}
