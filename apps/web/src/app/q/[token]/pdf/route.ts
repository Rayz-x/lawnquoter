import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { loadBrandingRaster } from "@/lib/brand/raster";
import { brandingPathOrgId } from "@/lib/brand/urls";
import { loadPublicQuote } from "../load-public-quote";
import { ProposalPdf } from "../proposal-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadPublicQuote(token);
  if (!loaded) return new NextResponse("Not found", { status: 404 });
  const { quote, acceptance } = loaded;
  const requested = new URL(req.url).searchParams.get("selected");
  const selectedIds = requested ? requested.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : null;
  const stored = quote.acceptance;
  const logoOrgId = brandingPathOrgId(quote.org.logo_raster_url);
  const logo = logoOrgId ? await loadBrandingRaster(quote.org.logo_raster_url, logoOrgId) : null;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const buf = await renderToBuffer(
    ProposalPdf({
      payload: quote,
      selectedIds: stored?.selections?.length ? stored.selections : selectedIds,
      acceptance,
      logo,
      quoteUrl: `${base}/q/${token}`,
    }),
  );
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${quote.number}.pdf"`,
    },
  });
}
