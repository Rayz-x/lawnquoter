import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/session";
import { assembleEvidencePack } from "@/lib/billing/evidence-pack";
import { createEvidencePackStore } from "@/lib/billing/supabase-evidence-pack-store";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type UntypedFilter = {
  eq: (col: string, value: string) => UntypedFilter;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
};

type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
  };
};

/** Downloadable dispute evidence pack (after photo, completion time, acceptance). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireOrg();
  const { id: invoiceId } = await context.params;

  const supabase = (await createClient()) as unknown as UntypedClient;
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, org_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!invoice || String(invoice.org_id) !== session.orgId) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const result = await assembleEvidencePack({
    invoiceId,
    store: createEvidencePackStore(createAdminClient()),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(result.pack, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="evidence-pack-${invoiceId}.json"`,
    },
  });
}
