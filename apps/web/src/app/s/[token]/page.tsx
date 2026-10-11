import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyleSheet, deriveBrandTheme } from "@/lib/brand/derive-brand-theme";
import { headingFontOf } from "@/lib/brand/public-org";
import {
  isPublicAccountStatement,
  type PublicAccountStatement,
} from "@/lib/billing/public-statement";
import { createClient } from "@/lib/supabase/server";
import { headingSturdy } from "@/app/q/[token]/heading-font";
import { orgFromPayload, text } from "@/app/q/[token]/org-from-payload";
import { StatementView } from "./statement-view";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

function parseDate(value: string | undefined, fallback: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

async function loadPublicStatement(
  token: string,
  from: string,
  to: string,
): Promise<PublicAccountStatement | null> {
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data } = await supabase.rpc("account_statement_public", {
    p_token: token,
    p_from: from,
    p_to: to,
  });
  if (!isPublicAccountStatement(data)) return null;
  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  if (!UUID_RE.test(token)) return { title: "Statement" };
  const range = defaultRange();
  const data = await loadPublicStatement(token, range.from, range.to);
  const name = data ? text(data.org?.name) : null;
  return { title: name ? `${name} statement` : "Statement" };
}

export default async function PublicStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const query = await searchParams;
  const fallback = defaultRange();
  const from = parseDate(query.from, fallback.from);
  const to = parseDate(query.to, fallback.to);
  if (to < from) notFound();

  const record = await loadPublicStatement(token, from, to);
  if (!record) notFound();

  const org = orgFromPayload(record.org);
  const theme = deriveBrandTheme(org.brand_color);

  return (
    <div
      data-tenant-brand
      data-heading={headingFontOf(org.heading_font)}
      className={headingSturdy.variable}
    >
      <style>{brandStyleSheet(theme)}</style>
      <StatementView payload={{ ...record, org }} />
    </div>
  );
}
