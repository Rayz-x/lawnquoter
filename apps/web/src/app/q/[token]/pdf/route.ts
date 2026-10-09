import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { ProposalPdf, type PdfAcceptance } from "../proposal-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data) return new NextResponse("Not found", { status: 404 });
  const payload = data as PublicQuote;
  const requested = new URL(req.url).searchParams.get("selected");
  const selectedIds = requested ? requested.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : null;
  const stored = payload.acceptance;
  const acceptance: PdfAcceptance | null = stored
    ? {
        documentHash: stored.document_hash,
        acceptedAt: stored.accepted_at,
        signerName: stored.signer_name,
        signerEmail: stored.signer_email,
        acceptedTotal: Number(stored.accepted_total ?? 0),
        notToExceed: Number(stored.accepted_not_to_exceed ?? stored.accepted_total ?? 0),
        hasRanges: stored.has_ranges,
        clause: stored.not_to_exceed_clause,
        disclosureVersion: stored.disclosure_version,
      }
    : null;
  const buf = await renderToBuffer(
    ProposalPdf({
      payload,
      selectedIds: stored?.selections?.length ? stored.selections : selectedIds,
      acceptance,
    }),
  );
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${payload.number}.pdf"`,
    },
  });
}
