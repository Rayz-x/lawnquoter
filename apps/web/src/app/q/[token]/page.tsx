import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyleSheet, deriveBrandTheme } from "@/lib/brand/derive-brand-theme";
import { headingFontOf } from "@/lib/brand/public-org";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "./heading-font";
import { orgFromPayload, text } from "./org-from-payload";
import { ProposalView } from "./proposal-view";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  const name = data && typeof data === "object" && data !== null && "org" in data ? text((data.org as { name?: unknown }).name) : null;
  return { title: name ? `${name} proposal` : "Proposal" };
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data || typeof data !== "object") notFound();
  const record = data as PublicQuote;
  const org = orgFromPayload(record.org);
  const theme = deriveBrandTheme(org.brand_color);

  return (
    <div data-tenant-brand data-heading={headingFontOf(org.heading_font)} className={headingSturdy.variable}>
      <style>{brandStyleSheet(theme)}</style>
      <ProposalView token={token} payload={{ ...record, org }} />
    </div>
  );
}
