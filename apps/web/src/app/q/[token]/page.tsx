import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Instrument_Serif } from "next/font/google";
import { brandStyleSheet, deriveBrandTheme, quoteEditorialBrandCss } from "@/lib/brand/derive-brand-theme";
import { headingFontOf } from "@/lib/brand/public-org";
import { headingSturdy } from "./heading-font";
import { loadPublicQuote } from "./load-public-quote";
import { ProposalView } from "./proposal-view";

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const loaded = await loadPublicQuote(token);
  return { title: loaded ? `${loaded.quote.org.name} proposal` : "Proposal" };
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadPublicQuote(token);
  if (!loaded) notFound();
  const { quote } = loaded;
  const theme = deriveBrandTheme(quote.org.brand_color);

  return (
    <div
      data-tenant-brand
      data-heading={headingFontOf(quote.org.heading_font)}
      className={`${headingSturdy.variable} ${instrument.variable} quote-editorial`}
    >
      <style>{`${brandStyleSheet(theme)}${quoteEditorialBrandCss(theme)}`}</style>
      <ProposalView token={token} payload={quote} wisetackUrl={process.env.WISETACK_PREQUAL_URL ?? null} />
    </div>
  );
}
