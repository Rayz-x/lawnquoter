"use server";

import { headers } from "next/headers";
import { createLeadIntakeStore } from "@/lib/leads/intake-store";
import { instantQuoteWriteAllowed } from "@/lib/leads/instant-quote-guard";
import {
  instantQuoteFromCatalog,
  type CatalogRuleInput,
} from "@/lib/leads/instant-quote-price";
import {
  instantQuoteLeadRow,
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

/** Save the contact, then return the catalog range. Rules stay on the server. */
export async function revealInstantQuote(
  slug: string,
  draft: InstantQuoteDraft,
  guards: { turnstileToken: string; honeypot: string },
): Promise<(InstantQuoteOffer & { leadId: string }) | null> {
  const org = await loadInstantQuotePage(slug);
  if (!org) return null;
  const row = instantQuoteLeadRow(org.orgId, draft);
  if (!row) return null;

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

  const catalog = await loadInstantQuoteCatalog(org.orgId, admin);
  const offer = instantQuoteFromCatalog({
    draft,
    serviceAreaZips: org.config.serviceAreaZips,
    statedMinimum: org.config.statedMinimum,
    rules: catalog.rules,
    modifiers: catalog.modifiers,
    confidence: draft.measurementConfidence ?? 0.4,
  });
  if (!offer) return null;

  const { data, error } = await admin
    .from("lead_requests")
    .insert({ ...row, ip_hash: hashClientIp(ip) })
    .select("id")
    .single();
  if (error || !data) return null;
  return { ...offer, leadId: data.id };
}

async function loadInstantQuoteCatalog(
  orgId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ rules: CatalogRuleInput[]; modifiers: unknown }> {
  const { data: list } = await admin
    .from("price_lists")
    .select("id, modifiers")
    .eq("org_id", orgId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!list) return { rules: [], modifiers: {} };
  const { data: rules } = await admin
    .from("pricing_rules")
    .select("name, config")
    .eq("org_id", orgId)
    .eq("price_list_id", list.id)
    .eq("active", true);
  return { rules: rules ?? [], modifiers: list.modifiers };
}
