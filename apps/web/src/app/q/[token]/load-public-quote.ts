import "server-only";

import { cache } from "react";
import type { PublicAcceptance, PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { orgFromPayload } from "./org-from-payload";
import type { PdfAcceptance } from "./proposal-pdf";

export type LoadedPublicQuote = {
  quote: PublicQuote;
  acceptance: PdfAcceptance | null;
};

function pdfAcceptance(stored: PublicAcceptance | null): PdfAcceptance | null {
  if (!stored) return null;
  return {
    documentHash: stored.document_hash,
    acceptedAt: stored.accepted_at,
    signerName: stored.signer_name,
    signerEmail: stored.signer_email,
    acceptedTotal: Number(stored.accepted_total ?? 0),
    notToExceed: Number(stored.accepted_not_to_exceed ?? stored.accepted_total ?? 0),
    hasRanges: stored.has_ranges,
    clause: stored.not_to_exceed_clause,
    disclosureVersion: stored.disclosure_version,
  };
}

/** One read of `quote_public` per request: normalized org, and one acceptance mapping. Null when the token has no quote. */
export const loadPublicQuote = cache(async (token: string): Promise<LoadedPublicQuote | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data || typeof data !== "object") return null;
  const record = data as PublicQuote;
  const quote: PublicQuote = { ...record, org: orgFromPayload(record.org) };
  return { quote, acceptance: pdfAcceptance(quote.acceptance) };
});
