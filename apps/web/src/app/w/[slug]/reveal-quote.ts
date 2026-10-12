"use server";

import {
  instantQuoteLeadRow,
  instantQuoteOffer,
  type InstantQuoteDraft,
  type InstantQuoteOffer,
} from "@/lib/leads/instant-quote";
import { loadInstantQuotePage } from "@/lib/leads/load-public-form";
import { createAdminClient } from "@/lib/supabase/server";

/** Save the contact, then return the range. The rate never leaves the server. */
export async function revealInstantQuote(
  slug: string,
  draft: InstantQuoteDraft,
): Promise<InstantQuoteOffer | null> {
  const org = await loadInstantQuotePage(slug);
  if (!org) return null;
  const offer = instantQuoteOffer(draft, org.config);
  const row = instantQuoteLeadRow(org.orgId, draft);
  if (!offer || !row) return null;
  const { error } = await createAdminClient().from("lead_requests").insert(row);
  if (error) return null;
  return offer;
}
