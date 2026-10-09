import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProposalPdf } from "../proposal-pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data) return new NextResponse("Not found", { status: 404 });
  const payload = data as {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    org: { name: string };
    items: Array<{ name: string; price: number; state: string; description: string | null }>;
  };
  const buf = await renderToBuffer(ProposalPdf({ payload }));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${payload.number}.pdf"`,
    },
  });
}
