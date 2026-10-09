import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { brandingAssetUrl } from "@/lib/brand/urls";
import { type PublicOrg } from "@/lib/brand/public-org";
import { type SelectableItem } from "@/lib/quotes/selection";
import { createClient } from "@/lib/supabase/server";
import { ProposalPdf } from "../proposal-pdf";

type PdfItem = SelectableItem & {
  name: string;
  description: string | null;
  state: string;
  range_low?: number | null;
  range_high?: number | null;
};

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
    logo_width: typeof org.logo_width === "number" ? org.logo_width : null,
    logo_height: typeof org.logo_height === "number" ? org.logo_height : null,
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

async function loadRaster(path: string | null): Promise<Buffer | null> {
  const url = brandingAssetUrl(path);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const png = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpeg = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    return png || jpeg ? bytes : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data || typeof data !== "object") return new NextResponse("Not found", { status: 404 });
  const record = data as {
    title?: string;
    number?: number;
    intro?: string | null;
    notes_customer?: string | null;
    org?: unknown;
    items?: PdfItem[];
  };
  const org = orgFromPayload(record.org);
  const payload = {
    title: record.title ?? "Quote",
    number: record.number ?? 0,
    intro: record.intro ?? null,
    notes_customer: record.notes_customer ?? null,
    org,
    items: record.items ?? [],
  };
  const requested = new URL(req.url).searchParams.get("selected");
  const selectedIds = requested ? requested.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : null;
  const logo = await loadRaster(org.logo_raster_url);
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const buf = await renderToBuffer(ProposalPdf({ payload, selectedIds, logo, quoteUrl: `${base}/q/${token}` }));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${payload.number}.pdf"`,
    },
  });
}
