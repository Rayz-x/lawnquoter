"use server";

import {
  depositAmountCents,
  startDepositCheckout,
  type DepositCheckoutResult,
} from "@/lib/leads/instant-quote-deposit";
import { type InstantQuoteDraft } from "@/lib/leads/instant-quote";
import { instantQuoteFromCatalog, type CatalogRuleInput } from "@/lib/leads/instant-quote-price";
import { loadInstantQuotePage } from "@/lib/leads/load-public-form";
import { getStripe } from "@/lib/stripe/client";
import { isPayEnabled, type ConnectStatus } from "@/lib/stripe/connect";
import { createAdminClient } from "@/lib/supabase/server";

const off = { ok: false as const, reason: "not_connected" as const };

function origin() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

/** True only when the platform key is set and this company can take a Connect payment. */
export async function instantQuoteDepositAvailable(orgId: string): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return false;
  const { data } = await createAdminClient()
    .from("org_stripe_connect")
    .select("stripe_account_id, status")
    .eq("org_id", orgId)
    .maybeSingle();
  const status = (data?.status ?? "not_connected") as ConnectStatus;
  return Boolean(data?.stripe_account_id) && isPayEnabled(status);
}

/** Open Checkout for the deposit. Returns before Stripe when the key or Connect account is missing. */
export async function startInstantQuoteDeposit(
  slug: string,
  leadId: string,
  draft: InstantQuoteDraft,
): Promise<DepositCheckoutResult> {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return off;
  const org = await loadInstantQuotePage(slug);
  if (!org || !leadId.trim()) return off;
  const admin = createAdminClient();
  const { data: connect } = await admin
    .from("org_stripe_connect")
    .select("stripe_account_id, status")
    .eq("org_id", org.orgId)
    .maybeSingle();
  const status = (connect?.status ?? "not_connected") as ConnectStatus;
  if (!connect?.stripe_account_id || !isPayEnabled(status)) return off;
  const { data: lead } = await admin.from("lead_requests").select("id").eq("id", leadId).eq("org_id", org.orgId).maybeSingle();
  if (!lead) return off;

  const catalog = await loadCatalog(org.orgId);
  const offer = instantQuoteFromCatalog({
    draft,
    serviceAreaZips: org.config.serviceAreaZips,
    statedMinimum: org.config.statedMinimum,
    rules: catalog.rules,
    modifiers: catalog.modifiers,
    confidence: draft.measurementConfidence ?? 0.4,
  });
  const amountCents = offer ? depositAmountCents(org.config.depositCents, offer.low) : null;
  if (amountCents == null) return off;

  const base = `${origin()}/w/${org.slug}`;
  return startDepositCheckout({
    stripeAccountId: connect.stripe_account_id,
    amountCents,
    leadId: lead.id,
    orgId: org.orgId,
    successUrl: `${base}?deposit=paid`,
    cancelUrl: base,
    stripe: getStripe() as Parameters<typeof startDepositCheckout>[0]["stripe"],
  });
}

async function loadCatalog(orgId: string): Promise<{ rules: CatalogRuleInput[]; modifiers: unknown }> {
  const admin = createAdminClient();
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
