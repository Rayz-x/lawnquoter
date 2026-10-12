import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/session";
import { EXPORT_COLUMNS, exportJson, exportPdfLines, invoicePdfLines, storedZip, tableCsv, type Row } from "@/lib/export/bundle";
import { ExportPdf } from "@/lib/export/export-pdf";
import { createClient } from "@/lib/supabase/server";

const PAGE = 1000;
const MAX = 20000;

async function allRows(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function GET() {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") {
    return new NextResponse("Owners and admins can export company data.", { status: 403 });
  }
  const supabase = await createClient();
  try {
    const [accounts, properties, quotes, invoices] = await Promise.all([
      allRows((from, to) => supabase.from("accounts").select(EXPORT_COLUMNS.accounts.join(",")).eq("org_id", session.orgId).range(from, to)),
      allRows((from, to) => supabase.from("properties").select(EXPORT_COLUMNS.properties.join(",")).eq("org_id", session.orgId).range(from, to)),
      allRows((from, to) => supabase.from("quotes").select(EXPORT_COLUMNS.quotes.join(",")).eq("org_id", session.orgId).range(from, to)),
      allRows((from, to) => supabase.from("invoices").select(EXPORT_COLUMNS.invoices.join(",")).eq("org_id", session.orgId).range(from, to)),
    ]);
    const tables = { accounts, properties, quotes, invoices };
    const lines = exportPdfLines(tables);
    const invoiceLines = invoicePdfLines(tables);
    if (accounts.length >= MAX) lines.push("Accounts stopped at 20000 rows.");
    if (properties.length >= MAX) lines.push("Properties stopped at 20000 rows.");
    if (quotes.length >= MAX) lines.push("Quotes stopped at 20000 rows.");
    if (invoices.length >= MAX) {
      lines.push("Invoices stopped at 20000 rows.");
      invoiceLines.push("Invoices stopped at 20000 rows.");
    }
    const [pdf, invoicePdf] = await Promise.all([
      renderToBuffer(ExportPdf({ lines })),
      renderToBuffer(ExportPdf({ lines: invoiceLines })),
    ]);
    const encoder = new TextEncoder();
    const zip = storedZip([
      { name: "accounts.csv", bytes: encoder.encode(tableCsv(EXPORT_COLUMNS.accounts, accounts)) },
      { name: "properties.csv", bytes: encoder.encode(tableCsv(EXPORT_COLUMNS.properties, properties)) },
      { name: "quotes.csv", bytes: encoder.encode(tableCsv(EXPORT_COLUMNS.quotes, quotes)) },
      { name: "invoices.csv", bytes: encoder.encode(tableCsv(EXPORT_COLUMNS.invoices, invoices)) },
      { name: "export.json", bytes: encoder.encode(exportJson(tables)) },
      { name: "register.pdf", bytes: new Uint8Array(pdf) },
      { name: "invoices.pdf", bytes: new Uint8Array(invoicePdf) },
    ]);
    return new NextResponse(Buffer.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="lawnquoter-export.zip"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export company data.";
    return new NextResponse(message, { status: 500 });
  }
}
