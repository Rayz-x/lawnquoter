"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import { headers } from "next/headers";
import { z } from "zod";
import { acceptedQuoteMessage } from "@/lib/email/accepted-quote";
import { createEmailProvider } from "@/lib/email/provider";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { ProposalPdf } from "./proposal-pdf";

const acceptSchema = z.object({
  signer_name: z.string().trim().min(2, "Enter your full name"),
  signer_email: z.string().trim().email("Enter a valid email"),
  disclosure: z.literal(true, { error: "Please accept the electronic signature disclosure" }),
  selected: z.array(z.string().uuid()).default([]),
});

function clientIp(hdrs: Headers): string | null {
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || hdrs.get("x-real-ip")?.trim() || "";
  if (!raw || !/^[0-9a-fA-F:.]+$/.test(raw)) return null;
  return raw;
}

async function emailSealedCopy(token: string, to: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("quote_public", { p_token: token });
    if (!data || typeof data !== "object") return false;
    const payload = data as PublicQuote;
    const acceptance = payload.acceptance;
    if (!acceptance?.document_hash) return false;
    const selected = Array.isArray(acceptance.selections)
      ? acceptance.selections.filter((id): id is string => typeof id === "string")
      : null;
    const pdf = await renderToBuffer(
      ProposalPdf({
        payload,
        selectedIds: selected,
        acceptance: {
          documentHash: acceptance.document_hash,
          acceptedAt: acceptance.accepted_at,
          signerName: acceptance.signer_name,
          signerEmail: acceptance.signer_email,
          acceptedTotal: Number(acceptance.accepted_total ?? 0),
          notToExceed: Number(acceptance.accepted_not_to_exceed ?? acceptance.accepted_total ?? 0),
          hasRanges: acceptance.has_ranges,
          clause: acceptance.not_to_exceed_clause,
          disclosureVersion: acceptance.disclosure_version,
        },
      }),
    );
    const result = await createEmailProvider().send(
      acceptedQuoteMessage({
        to,
        orgName: payload.org.name,
        quoteNumber: payload.number,
        documentHash: acceptance.document_hash,
        clause: acceptance.not_to_exceed_clause,
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_accept", {
    p_token: token,
    p_signer_name: parsed.data.signer_name,
    p_signer_email: parsed.data.signer_email,
    p_disclosure: true,
    p_user_agent: hdrs.get("user-agent") ?? undefined,
    p_ip: clientIp(hdrs) ?? undefined,
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
