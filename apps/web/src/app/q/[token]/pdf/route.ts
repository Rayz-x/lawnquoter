import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { type SelectableItem } from "@/lib/quotes/selection";
import { createClient } from "@/lib/supabase/server";
import { ProposalPdf } from "../proposal-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data) return new NextResponse("Not found", { status: 404 });
  const payload = data as {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    org: { name: string; brand_color?: string | null };
    items: Array<
      SelectableItem & {
        name: string;
        description: string | null;
        state: string;
        range_low?: number | null;
        range_high?: number | null;
      }
    >;
  };
  const requested = new URL(req.url).searchParams.get("selected");
  const selectedIds = requested ? requested.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : null;
  const buf = await renderToBuffer(ProposalPdf({ payload, selectedIds }));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${payload.number}.pdf"`,
    },
  });
}
