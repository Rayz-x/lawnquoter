"use server";

import { headers } from "next/headers";
import { createLeadIntakeStore } from "@/lib/leads/intake-store";
import { instantQuoteWriteAllowed } from "@/lib/leads/instant-quote-guard";
import {
  instantQuoteLeadRow,
  instantQuoteOffer,
  type InstantQuoteDraft,
  type InstantQuoteOffer,
} from "@/lib/leads/instant-quote";
import { loadInstantQuotePage } from "@/lib/leads/load-public-form";
import { hashClientIp } from "@/lib/leads/submit-request";
import { verifyTurnstileToken } from "@/lib/leads/turnstile";
import { createAdminClient } from "@/lib/supabase/server";

function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headerList.get("x-real-ip")?.trim() || null;
}

/** Save the contact, then return the range. The rate never leaves the server. */
export async function revealInstantQuote(
  slug: string,
  draft: InstantQuoteDraft,
  guards: { turnstileToken: string; honeypot: string },
): Promise<InstantQuoteOffer | null> {
  const org = await loadInstantQuotePage(slug);
  if (!org) return null;
  const offer = instantQuoteOffer(draft, org.config);
  const row = instantQuoteLeadRow(org.orgId, draft);
  if (!offer || !row) return null;

  const headerList = await headers();
  const ip = clientIp(headerList);
  const admin = createAdminClient();
  const store = createLeadIntakeStore(admin);
  const allowed = await instantQuoteWriteAllowed(
    {
      turnstileToken: guards.turnstileToken,
      honeypot: guards.honeypot,
      clientIp: ip,
      orgId: org.orgId,
    },
    {
      verifyTurnstile: verifyTurnstileToken,
      countRecentByIpHash: store.countRecentByIpHash,
      countRecentByOrg: store.countRecentByOrg,
      nowMs: () => Date.now(),
    },
  );
  if (allowed !== "ok") return null;

  const { error } = await admin.from("lead_requests").insert({ ...row, ip_hash: hashClientIp(ip) });
  if (error) return null;
  return offer;
}
