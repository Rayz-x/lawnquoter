"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import { headers } from "next/headers";
import { z } from "zod";
import { loadBrandingRaster } from "@/lib/brand/raster";
import { brandingPathOrgId } from "@/lib/brand/urls";
import { signerAuditHeaders } from "@/lib/actions/signer-audit";
import { fail, type ActionResult } from "@/lib/actions/result";
import { acceptedQuoteMessage } from "@/lib/email/accepted-quote";
import { createEmailProvider } from "@/lib/email/provider";
import { SITE_CHECK_REQUEST_LIMIT_ERROR } from "./request-limit";
import { createClient } from "@/lib/supabase/server";
import { loadPublicQuote } from "./load-public-quote";
import { ProposalPdf } from "./proposal-pdf";

const acceptSchema = z.object({
  signer_name: z.string().trim().min(2, "Enter your full name"),
  signer_email: z.string().trim().email("Enter a valid email"),
  disclosure: z.literal(true, { error: "Please accept the electronic signature disclosure" }),
  selected: z.array(z.string().uuid()).default([]),
});

async function emailSealedCopy(token: string, to: string): Promise<boolean> {
  try {
    const loaded = await loadPublicQuote(token);
    if (!loaded?.acceptance?.documentHash) return false;
    const { quote, acceptance } = loaded;
    const selected = Array.isArray(quote.acceptance?.selections)
      ? quote.acceptance.selections.filter((id): id is string => typeof id === "string")
      : null;
    const logoOrgId = brandingPathOrgId(quote.org.logo_raster_url);
    const logo = logoOrgId ? await loadBrandingRaster(quote.org.logo_raster_url, logoOrgId) : null;
    const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const pdf = await renderToBuffer(
      ProposalPdf({
        payload: quote,
        selectedIds: selected,
        logo,
        quoteUrl: `${base}/q/${token}`,
        acceptance,
      }),
    );
    const result = await createEmailProvider().send(
      acceptedQuoteMessage({
        to,
        orgName: quote.org.name,
        quoteNumber: quote.number,
        documentHash: acceptance.documentHash,
        clause: acceptance.clause,
        pdf: Buffer.from(pdf),
      }),
    );
    return result.sent;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "accepted quote email failed");
    return false;
  }
}

export async function acceptQuote(
  token: string,
  fd: FormData,
): Promise<ActionResult<{ hash: string; already: boolean; emailed: boolean }>> {
  const parsed = acceptSchema.safeParse({
    signer_name: fd.get("signer_name"),
    signer_email: fd.get("signer_email") ?? "",
    disclosure: fd.get("disclosure") === "on" || fd.get("disclosure") === "true" ? true : false,
    selected: fd.getAll("selected"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again");

  const hdrs = await headers();
  const supabase = await createClient({ headers: signerAuditHeaders(hdrs) });
  const { data, error } = await supabase.rpc("quote_accept", {
    p_token: token,
    p_signer_name: parsed.data.signer_name,
    p_signer_email: parsed.data.signer_email,
    p_disclosure: true,
    p_selected: parsed.data.selected,
  });
  if (error) return fail(error.message);
  const body = data && typeof data === "object" ? (data as { document_hash?: string; already?: boolean; ok?: boolean }) : {};
  if (body.ok !== true && body.already !== true) return fail("Could not accept this proposal");
  const already = body.already === true;
  const emailed = already ? false : await emailSealedCopy(token, parsed.data.signer_email);
  return { ok: true, data: { hash: body.document_hash ?? "", already, emailed } };
}

export async function declineQuote(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("quote_decline", { p_token: token });
  if (error) return fail(error.message);
  return { ok: true };
}

const requestSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  note: z.string().trim().max(2000).optional(),
  selected: z.array(z.string().uuid()).default([]),
});

export async function requestFinalPrice(
  token: string,
  fd: FormData,
): Promise<ActionResult<{ status: string }>> {
  const parsed = requestSchema.safeParse({
    email: fd.get("email") ?? "",
    note: fd.get("note") || undefined,
    selected: fd.getAll("selected"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again");

  const hdrs = await headers();
  const supabase = await createClient({ headers: signerAuditHeaders(hdrs) });
  const { data, error } = await supabase.rpc("site_check_request", {
    p_token: token,
    p_email: parsed.data.email,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
    p_selected: parsed.data.selected,
  });
  if (error) {
    if (/account request limit/i.test(error.message)) {
      return fail(SITE_CHECK_REQUEST_LIMIT_ERROR);
    }
    if (/rate limit/i.test(error.message)) {
      return fail("Too many requests. Please try again in a little while.");
    }
    return fail(error.message);
  }
  const body = data && typeof data === "object" ? (data as { ok?: boolean; status?: string }) : {};
  if (body.ok !== true) return fail("Could not request a final price");
  return { ok: true, data: { status: body.status ?? "requested" } };
}

export async function cancelFinalPriceRequest(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("site_check_cancel_request", { p_token: token });
  if (error) return fail(error.message);
  return { ok: true };
}
