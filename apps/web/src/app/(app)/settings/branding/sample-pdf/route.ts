import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { ProposalPdf } from "@/app/q/[token]/proposal-pdf";
import { normalizeHex } from "@/lib/brand/derive-brand-theme";
import { headingFontOf, type PublicOrg } from "@/lib/brand/public-org";
import { loadBrandingRaster } from "@/lib/brand/raster";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_QUOTE_ITEMS } from "../../sample-quote";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.orgId) return new NextResponse("Sign in required", { status: 401 });
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("*").eq("id", session.orgId).single();
  if (!org) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const color = normalizeHex(url.searchParams.get("color")) ?? org.brand_color;
  const heading = headingFontOf(url.searchParams.get("heading") ?? org.heading_font);
  const payloadOrg: PublicOrg = {
    name: org.name,
    phone: org.phone,
    email: org.email,
    website: org.website,
    brand_color: color,
    logo_url: org.logo_path,
    logo_dark_url: org.logo_dark_path,
    logo_raster_url: org.logo_raster_path,
    logo_width: org.logo_width,
    logo_height: org.logo_height,
    logo_shows_name: org.logo_shows_name,
    logo_needs_chip: org.logo_needs_chip,
    heading_font: heading,
    address_line1: org.address_line1,
    address_line2: org.address_line2,
    city: org.city,
    region: org.region,
    postal_code: org.postal_code,
    country: org.country,
  };
  const logo = await loadBrandingRaster(org.logo_raster_path, session.orgId);
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const buf = await renderToBuffer(
    ProposalPdf({
      payload: {
        title: "Weekly maintenance",
        number: 1042,
        intro: "A season of mowing, edging, and beds.",
        notes_customer: "Gate code 1908.",
        org: payloadOrg,
        items: SAMPLE_QUOTE_ITEMS,
      },
      selectedIds: ["00000000-0000-4000-8000-000000000002"],
      logo,
      quoteUrl: `${base}/q/sample`,
    }),
  );
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"sample-quote.pdf\"" },
  });
}
