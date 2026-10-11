import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import type { PublicInvoice } from "@/lib/billing/public-invoice";
import { createClient } from "@/lib/supabase/server";
import { orgFromPayload } from "@/app/q/[token]/org-from-payload";
import { InvoicePdf } from "../invoice-pdf";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return new NextResponse("Not found", { status: 404 });
  const supabase = (await createClient()) as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data } = await supabase.rpc("invoice_public", { p_token: token });
  if (!data || typeof data !== "object") return new NextResponse("Not found", { status: 404 });
  const record = data as PublicInvoice;
  const org = orgFromPayload(record.org);
  const payload = { ...record, org };
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const buf = await renderToBuffer(
    InvoicePdf({
      payload,
      invoiceUrl: `${base}/i/${token}`,
    }),
  );
  const filename = payload.number_label ?? "invoice";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
    },
  });
}
