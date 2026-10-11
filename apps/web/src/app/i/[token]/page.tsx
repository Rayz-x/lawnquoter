import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyleSheet, deriveBrandTheme } from "@/lib/brand/derive-brand-theme";
import { headingFontOf } from "@/lib/brand/public-org";
import type { PublicInvoice } from "@/lib/billing/public-invoice";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "@/app/q/[token]/heading-font";
import { orgFromPayload, text } from "@/app/q/[token]/org-from-payload";
import { InvoiceView } from "./invoice-view";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function loadPublicInvoice(token: string): Promise<PublicInvoice | null> {
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data } = await supabase.rpc("invoice_public", { p_token: token });
  if (!data || typeof data !== "object") return null;
  return data as PublicInvoice;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  if (!UUID_RE.test(token)) return { title: "Invoice" };
  const data = await loadPublicInvoice(token);
  const name = data ? text(data.org?.name) : null;
  return { title: name ? `${name} invoice` : "Invoice" };
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();
  const record = await loadPublicInvoice(token);
  if (!record) notFound();
  const org = orgFromPayload(record.org);
  const theme = deriveBrandTheme(org.brand_color);

  return (
    <div data-tenant-brand data-heading={headingFontOf(org.heading_font)} className={headingSturdy.variable}>
      <style>{brandStyleSheet(theme)}</style>
      <InvoiceView token={token} payload={{ ...record, org }} />
    </div>
  );
}
