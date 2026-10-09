import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyleSheet, deriveBrandTheme } from "@/lib/brand/derive-brand-theme";
import { headingFontOf, type PublicOrg } from "@/lib/brand/public-org";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "./heading-font";
import { ProposalView } from "./proposal-view";

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function orgFromPayload(raw: unknown): PublicOrg {
  const org = (raw ?? {}) as Record<string, unknown>;
  return {
    name: text(org.name) ?? "Quote",
    phone: text(org.phone),
    email: text(org.email),
    website: text(org.website),
    brand_color: text(org.brand_color),
    logo_url: text(org.logo_url),
    logo_dark_url: text(org.logo_dark_url),
    logo_raster_url: text(org.logo_raster_url),
    logo_width: typeof org.logo_width === "number" ? org.logo_width : Number(org.logo_width) || null,
    logo_height: typeof org.logo_height === "number" ? org.logo_height : Number(org.logo_height) || null,
    logo_shows_name: typeof org.logo_shows_name === "boolean" ? org.logo_shows_name : null,
    logo_needs_chip: org.logo_needs_chip === true,
    heading_font: text(org.heading_font),
    address_line1: text(org.address_line1),
    address_line2: text(org.address_line2),
    city: text(org.city),
    region: text(org.region),
    postal_code: text(org.postal_code),
    country: text(org.country),
  };
}

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
