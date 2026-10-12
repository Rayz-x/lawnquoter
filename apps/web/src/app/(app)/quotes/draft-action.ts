"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { aiQuoteDraftConfig, requestAiQuoteDraft } from "@/lib/quotes/ai-draft-provider";
import { draftFromSimilarQuotes, draftLineSort, nearestSimilarQuotes, type MemoryLine, type MemoryQuote } from "@/lib/quotes/neighborhood-draft";
import { createClient } from "@/lib/supabase/server";

const STATES = new Set(["included", "recommended", "optional"]);

export async function suggestQuoteDraft(quoteId: string): Promise<
  ActionResult<{ source: "ai" | "similar" | "none"; connected: boolean; lines: MemoryLine[] }>
> {
  if (!z.string().uuid().safeParse(quoteId).success) return fail("Invalid quote");
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail("You do not have access to edit quotes.");
  const supabase = await createClient();
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, property_id")
    .eq("id", quoteId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (error || !quote) return fail(error?.message ?? "Quote not found");
  if (!quote.property_id) return fail("Add a property before drafting.");
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("postal_code, lot_sqft")
    .eq("id", quote.property_id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (propertyError || !property) return fail(propertyError?.message ?? "Property not found");

  const { data: sameZipSites, error: sameZipError } = await supabase
    .from("properties")
    .select("id")
    .eq("org_id", session.orgId)
    .eq("postal_code", property.postal_code)
    .limit(200);
  if (sameZipError) return fail(sameZipError.message);
  const sameZipIds = (sameZipSites ?? []).map((site) => site.id);
  const accepted = supabase
    .from("quotes")
    .select("id, current_version, property_id")
    .eq("org_id", session.orgId)
    .eq("status", "accepted")
    .neq("id", quoteId)
    .not("property_id", "is", null);
  const [{ data: zipPast, error: zipError }, { data: recentPast, error: recentError }] = await Promise.all([
    sameZipIds.length ? accepted.in("property_id", sameZipIds).limit(80) : Promise.resolve({ data: [], error: null }),
    supabase
      .from("quotes")
      .select("id, current_version, property_id")
      .eq("org_id", session.orgId)
      .eq("status", "accepted")
      .neq("id", quoteId)
      .not("property_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  if (zipError) return fail(zipError.message);
  if (recentError) return fail(recentError.message);
  const past = [...(zipPast ?? []), ...(recentPast ?? []).filter((row) => !(zipPast ?? []).some((kept) => kept.id === row.id))];
  const propertyIds = [...new Set((past ?? []).map((row) => row.property_id).filter((id): id is string => Boolean(id)))];
  const { data: sites } = propertyIds.length
    ? await supabase.from("properties").select("id, postal_code, lot_sqft").eq("org_id", session.orgId).in("id", propertyIds)
    : { data: [] };
  const siteById = new Map((sites ?? []).map((site) => [site.id, site]));
  const quoteIds = (past ?? []).map((row) => row.id);
  const { data: versions } = quoteIds.length
    ? await supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", quoteIds)
    : { data: [] };
  const currentVersions = new Map<string, string>();
  for (const row of past ?? []) {
    const version = (versions ?? []).find((item) => item.quote_id === row.id && item.version === row.current_version);
    if (version) currentVersions.set(row.id, version.id);
  }
  const versionIds = [...currentVersions.values()];
  const { data: items } = versionIds.length
    ? await supabase.from("quote_line_items").select("version_id, name, price, qty, unit, state, sort").in("version_id", versionIds).order("sort")
    : { data: [] };

  const memory: MemoryQuote[] = (past ?? []).flatMap((row) => {
    const site = row.property_id ? siteById.get(row.property_id) : undefined;
    const versionId = currentVersions.get(row.id);
    if (!site || !versionId) return [];
    const lines = (items ?? []).flatMap((item) => {
      if (item.version_id !== versionId || !STATES.has(item.state)) return [];
      return [{
        name: item.name,
        price: Number(item.price),
        qty: Number(item.qty),
        unit: item.unit,
        state: item.state as MemoryLine["state"],
      }];
    });
    if (!lines.length) return [];
    return [{
      id: row.id,
      postalCode: site.postal_code,
      lotSqft: site.lot_sqft == null ? null : Number(site.lot_sqft),
      lat: null,
      lng: null,
      lines,
    }];
  });
  const probe = {
    postalCode: property.postal_code,
    lotSqft: property.lot_sqft == null ? null : Number(property.lot_sqft),
    lat: null,
    lng: null,
  };
  const similar = nearestSimilarQuotes(probe, memory);
  const apiKey = process.env.AI_QUOTE_API_KEY?.trim() ?? "";
  const apiUrl = process.env.AI_QUOTE_API_URL?.trim() ?? "";
  const connected = aiQuoteDraftConfig({ AI_QUOTE_API_KEY: apiKey, AI_QUOTE_API_URL: apiUrl }).connected;
  if (connected) {
    const aiLines = await requestAiQuoteDraft({
      fetchImpl: fetch,
      url: apiUrl,
      apiKey,
      probe,
      examples: similar,
    });
    if (aiLines) return { ok: true, data: { source: "ai", connected, lines: aiLines } };
  }
  const lines = draftFromSimilarQuotes(similar);
  return { ok: true, data: { source: lines.length ? "similar" : "none", connected, lines } };
}

const lineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  price: z.number().finite().nonnegative(),
  qty: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(40),
  state: z.enum(["included", "recommended", "optional"]),
});

export async function addDraftLines(quoteId: string, lines: MemoryLine[]): Promise<ActionResult<{ count: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail("You do not have access to edit quotes.");
  const parsed = z.object({ quoteId: z.string().uuid(), lines: z.array(lineSchema).min(1).max(40) }).safeParse({ quoteId, lines });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid draft");
  const supabase = await createClient();
  const { data: versionId, error: versionError } = await supabase.rpc("quote_current_version", { p_quote: parsed.data.quoteId });
  if (versionError || !versionId) return fail(versionError?.message ?? "Could not read this quote");
  const { data: section, error: sectionError } = await supabase
    .from("quote_sections")
    .select("id")
    .eq("version_id", versionId)
    .order("sort")
    .limit(1)
    .maybeSingle();
  if (sectionError || !section) return fail(sectionError?.message ?? "Could not read this quote");
  const { data: lastLine, error: sortError } = await supabase
    .from("quote_line_items")
    .select("sort")
    .eq("version_id", versionId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sortError) return fail(sortError.message);
  let count = 0;
  for (const line of parsed.data.lines) {
    const inserted = await supabase.from("quote_line_items").insert({
      org_id: session.orgId,
      version_id: versionId,
      section_id: section.id,
      name: line.name,
      state: line.state,
      qty: line.qty,
      unit: line.unit,
      price: line.price,
      selected: line.state === "included",
      quantity_source: "manual",
      site_check_reasons: [],
      sort: draftLineSort(lastLine?.sort ?? null, count),
    });
    if (inserted.error) return fail(inserted.error.message);
    count += 1;
  }
  revalidatePath(`/quotes/${parsed.data.quoteId}`);
  return { ok: true, data: { count } };
}
