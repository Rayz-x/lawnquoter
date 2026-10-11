"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, SALES_ROLES, hasRole, type OrgRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { priceCatalogLine, type MeasuredFeature, type PropertyPricingInput } from "@/lib/quotes/catalog-price";
import { customerCopyUpdateError } from "@/lib/quotes/customer-copy";
import { ACCEPTED_QUOTE_DELETE_ERROR, deleteQuoteError } from "@/lib/quotes/delete-quote";
import { autoSiteCheckReasons, mergeSiteCheckReasons, orgSiteCheckThreshold } from "@/lib/quotes/site-check";
import { createClient } from "@/lib/supabase/server";

const NOT_SAVED = "Could not save this change.";

function denyUnlessSales(role: OrgRole) {
  if (!hasRole(role, SALES_ROLES)) return fail("You do not have access to edit quotes.");
  return null;
}

function unchanged(data: { id: string }[] | null, error: { message: string } | null) {
  if (error) return fail(error.message);
  if (!data?.length) return fail(NOT_SAVED);
  return null;
}

async function createQuote(accountId: string, propertyId?: string | null): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_create", {
    p_account: accountId,
    p_property: propertyId ?? undefined,
    p_title: "Service quote",
  });
  if (error || !data) return fail(error?.message ?? "Could not create quote");
  revalidatePath("/quotes");
  return { ok: true, data: { id: data } };
}

export async function createQuoteAndGo(accountId: string, propertyId?: string | null): Promise<ActionResult<{ id: string }>> {
  const r = await createQuote(accountId, propertyId);
  if (!r.ok) return r;
  redirect(`/quotes/${r.data.id}`);
}

const optionalRange = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().nonnegative().optional(),
);

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  state: z.enum(["included", "recommended", "optional"]).default("included"),
  option_group: z.string().max(80).optional().or(z.literal("")),
  option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
  section_id: z.string().uuid().optional().or(z.literal("")),
  section_title: z.string().trim().max(80).optional().or(z.literal("")),
  qty: z.coerce.number().positive().default(1),
  unit: z.string().max(20).default("each"),
  price: z.coerce.number().nonnegative().default(0),
  hours: z.coerce.number().nonnegative().default(0),
  cost: z.coerce.number().nonnegative().default(0),
  range_low: optionalRange,
  range_high: optionalRange,
  photo_url: z.string().url().optional().or(z.literal("")),
  notes_customer: z.string().max(2000).optional().or(z.literal("")),
  notes_crew: z.string().max(2000).optional().or(z.literal("")),
});

async function editableVersion(quoteId: string, versionId: string, orgId: string) {
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("quote_versions")
    .select("id, quote_id, frozen")
    .eq("id", versionId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!version || version.quote_id !== quoteId) return { supabase, error: "Quote version not found" as const };
  if (version.frozen) return { supabase, error: "This proposal is frozen. Revise it before editing." as const };
  return { supabase, error: null };
}

export async function addLineItem(quoteId: string, versionId: string, fd: FormData): Promise<ActionResult<{ sectionId: string | null }>> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const rangeLow = parsed.data.range_low ?? null;
  const rangeHigh = parsed.data.range_high ?? null;
  if (rangeLow != null && rangeHigh != null) {
    if (rangeLow > rangeHigh) return fail("The low end of the range cannot be above the high end.");
    if (parsed.data.price < rangeLow || parsed.data.price > rangeHigh) {
      return fail("The price has to fall inside the range.");
    }
  }
  const { supabase, error: versionError } = await editableVersion(quoteId, versionId, session.orgId);
  if (versionError) return fail(versionError);
  let sectionId = parsed.data.section_id || null;
  if (parsed.data.section_title) {
    const { data: created, error: sectionError } = await supabase.from("quote_sections").insert({
      org_id: session.orgId,
      version_id: versionId,
      title: parsed.data.section_title,
    }).select("id");
    const missedSection = unchanged(created, sectionError);
    if (missedSection) return missedSection;
    sectionId = created?.[0]?.id ?? null;
  } else if (sectionId) {
    const { data: section } = await supabase.from("quote_sections").select("id, version_id").eq("id", sectionId).eq("org_id", session.orgId).maybeSingle();
    if (!section || section.version_id !== versionId) return fail("Section not found");
  }
  const { data, error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
    section_id: sectionId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    state: parsed.data.state,
    option_group: parsed.data.option_group || null,
    option_tier: parsed.data.option_tier,
    qty: parsed.data.qty,
    unit: parsed.data.unit,
    price: parsed.data.price,
    hours: parsed.data.hours,
    cost: parsed.data.cost,
    range_low: rangeLow,
    range_high: rangeHigh,
    photo_url: parsed.data.photo_url || null,
    notes_customer: parsed.data.notes_customer || null,
    notes_crew: parsed.data.notes_crew || null,
    selected: parsed.data.state === "included",
    quantity_source: "manual",
    site_check_reasons: [],
  }).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true, data: { sectionId } };
}

function lineVersion(row: { quote_versions: { quote_id: string; frozen: boolean } | { quote_id: string; frozen: boolean }[] | null }) {
  const version = row.quote_versions;
  return Array.isArray(version) ? (version[0] ?? null) : version;
}

export async function reorderLineItems(quoteId: string, sourceId: string, targetId: string): Promise<ActionResult> {
  if (sourceId === targetId) return { ok: true };
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from("quote_line_items")
    .select("id, sort, version_id, quote_versions(quote_id, frozen)")
    .in("id", [sourceId, targetId])
    .eq("org_id", session.orgId);
  if (readError) return fail(readError.message);
  const source = rows?.find((row) => row.id === sourceId);
  const target = rows?.find((row) => row.id === targetId);
  const sourceVersion = source ? lineVersion(source) : null;
  const targetVersion = target ? lineVersion(target) : null;
  if (!source || !target || !sourceVersion || !targetVersion) return fail("Line item not found");
  if (sourceVersion.quote_id !== quoteId || targetVersion.quote_id !== quoteId) return fail("Line item not found");
  if (sourceVersion.frozen || targetVersion.frozen) return fail("This proposal is frozen. Revise it before editing.");
  const write = (id: string, sort: number) =>
    supabase.from("quote_line_items").update({ sort }).eq("id", id).eq("org_id", session.orgId).select("id");
  if (source.sort === target.sort) {
    const { data: siblings, error: listError } = await supabase
      .from("quote_line_items")
      .select("id, sort")
      .eq("version_id", source.version_id)
      .eq("org_id", session.orgId)
      .order("sort")
      .order("id");
    if (listError) return fail(listError.message);
    const ordered = [...(siblings ?? [])];
    const from = ordered.findIndex((row) => row.id === source.id);
    const to = ordered.findIndex((row) => row.id === target.id);
    if (from < 0 || to < 0) return fail("Line item not found");
    const next = ordered.slice();
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    for (const [index, row] of next.entries()) {
      if (row.sort === index) continue;
      const { data, error } = await write(row.id, index);
      const missed = unchanged(data, error);
      if (missed) return missed;
    }
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true };
  }
  const { data: firstData, error: firstError } = await write(source.id, target.sort);
  const firstMissed = unchanged(firstData, firstError);
  if (firstMissed) return firstMissed;
  const { data: secondData, error: secondError } = await write(target.id, source.sort);
  const secondMissed = unchanged(secondData, secondError);
  if (!secondMissed) {
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true };
  }
  const { error: undoError } = await write(source.id, source.sort);
  if (undoError) return fail("Could not reorder these lines, and the first move could not be undone.");
  return secondMissed;
}

async function editableLine(quoteId: string, id: string, orgId: string) {
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("quote_line_items")
    .select("id, range_low, range_high, quote_versions(quote_id, frozen)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  const version = item ? lineVersion(item) : null;
  if (!item || !version || version.quote_id !== quoteId) return { supabase, item: null, error: "Line item not found" as const };
  if (version.frozen) return { supabase, item: null, error: "This proposal is frozen. Revise it before editing." as const };
  return { supabase, item, error: null };
}

export async function updateLineItem(quoteId: string, id: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({
      state: z.enum(["included", "recommended", "optional"]).optional(),
      name: z.string().trim().min(1).max(200).optional(),
      price: z.coerce.number().nonnegative().optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.state === undefined && parsed.data.name === undefined && parsed.data.price === undefined) {
    return fail("Nothing to save.");
  }
  const { supabase, item, error: lineError } = await editableLine(quoteId, id, session.orgId);
  if (lineError || !item) return fail(lineError ?? "Line item not found");
  const patch: { state?: "included" | "recommended" | "optional"; selected?: boolean; name?: string; price?: number } = {};
  if (parsed.data.state !== undefined) {
    patch.state = parsed.data.state;
    patch.selected = parsed.data.state === "included";
  }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.price !== undefined) {
    const rangeLow = item.range_low;
    const rangeHigh = item.range_high;
    if (rangeLow != null && rangeHigh != null) {
      if (parsed.data.price < rangeLow || parsed.data.price > rangeHigh) {
        return fail("The price has to fall inside the range.");
      }
    }
    patch.price = parsed.data.price;
  }
  const { data, error } = await supabase
    .from("quote_line_items")
    .update(patch)
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function updateQuoteTerms(id: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const raw = Object.fromEntries(fd);
  const parsed = z
    .object({
      deposit_amount: z.preprocess(
        (value) => (value === "" || value === undefined ? undefined : value),
        z.coerce.number().nonnegative().optional(),
      ),
      expires_at: z.preprocess(
        (value) => (value === "" ? null : value),
        z.union([z.string().date(), z.null()]).optional(),
      ),
    })
    .safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.deposit_amount === undefined && parsed.data.expires_at === undefined) {
    return fail("Nothing to save.");
  }
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, status, current_version")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!quote) return fail("Quote not found");
  const { data: version } = await supabase
    .from("quote_versions")
    .select("id, frozen")
    .eq("quote_id", id)
    .eq("org_id", session.orgId)
    .eq("version", quote.current_version)
    .maybeSingle();
  if (!version) return fail("Quote not found");
  if (version.frozen || (quote.status !== "draft" && quote.status !== "changed")) {
    return fail("This proposal is frozen. Revise it before editing.");
  }
  const patch: { deposit_amount?: number | null; expires_at?: string | null } = {};
  if (parsed.data.deposit_amount !== undefined) {
    const { data: lines } = await supabase
      .from("quote_line_items")
      .select("price")
      .eq("version_id", version.id)
      .eq("org_id", session.orgId)
      .eq("selected", true);
    const quoteTotal = (lines ?? []).reduce((sum, line) => sum + Number(line.price), 0);
    patch.deposit_amount = Math.min(parsed.data.deposit_amount, quoteTotal);
  }
  if (parsed.data.expires_at !== undefined) patch.expires_at = parsed.data.expires_at;
  const { data, error } = await supabase.from("quotes").update(patch).eq("id", id).eq("org_id", session.orgId).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${id}`);
  return { ok: true };
}

export async function deleteLineItem(quoteId: string, id: string): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const { supabase, error: lineError } = await editableLine(quoteId, id, session.orgId);
  if (lineError) return fail(lineError);
  const { data, error } = await supabase.from("quote_line_items").delete().eq("id", id).eq("org_id", session.orgId).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function updateQuoteMeta(id: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      intro: z.string().max(4000).optional().or(z.literal("")),
      notes_customer: z.string().max(4000).optional().or(z.literal("")),
      notes_internal: z.string().max(4000).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("title, intro, notes_customer, status, current_version")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!quote) return fail("Quote not found");
  const { data: version } = await supabase
    .from("quote_versions")
    .select("frozen")
    .eq("quote_id", id)
    .eq("org_id", session.orgId)
    .eq("version", quote.current_version)
    .maybeSingle();
  if (!version) return fail("Quote not found");
  const copyEditable = (quote.status === "draft" || quote.status === "changed") && !version.frozen;
  const locked = customerCopyUpdateError(copyEditable, quote, parsed.data);
  if (locked) return fail(locked);
  const patch: { title?: string; intro?: string | null; notes_customer?: string | null; notes_internal?: string | null } = {};
  if (copyEditable && parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (copyEditable && parsed.data.intro !== undefined) patch.intro = parsed.data.intro || null;
  if (copyEditable && parsed.data.notes_customer !== undefined) patch.notes_customer = parsed.data.notes_customer || null;
  if (parsed.data.notes_internal !== undefined) patch.notes_internal = parsed.data.notes_internal || null;
  if (copyEditable && parsed.data.title !== undefined && !patch.title) return fail("Title is required");
  if (Object.keys(patch).length === 0) return fail("Nothing to save.");
  const { data, error } = await supabase.from("quotes").update(patch).eq("id", id).eq("org_id", session.orgId).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${id}`);
  return { ok: true };
}

export async function sendQuote(id: string): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("status, public_token")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!quote) return fail("Quote not found");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (quote.status === "accepted" || quote.status === "declined" || quote.status === "expired") {
    return { ok: true, data: { url: `${base}/q/${quote.public_token}` } };
  }
  const { data: token, error } = await supabase.rpc("quote_send", { p_quote: id });
  if (error || !token) return fail(error?.message ?? "Could not send");
  revalidatePath(`/quotes/${id}`);
  return { ok: true, data: { url: `${base}/q/${token}` } };
}

export async function deleteQuote(id: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return fail("Only an owner or admin can delete a quote.");
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("status")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!quote) return fail("Quote not found");
  const blocked = deleteQuoteError(quote.status);
  if (blocked) return fail(blocked);
  const { data, error } = await supabase.from("quotes").delete().eq("id", id).eq("org_id", session.orgId).select("id");
  if (error) {
    if (error.message.toLowerCase().includes("accepted quotes cannot be deleted")) {
      return fail(ACCEPTED_QUOTE_DELETE_ERROR);
    }
    return fail(error.message);
  }
  if (!data?.length) return fail(NOT_SAVED);
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  return { ok: true };
}

export async function reviseQuote(id: string): Promise<ActionResult<{ versionId: string }>> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const supabase = await createClient();
  const { data: versionId, error } = await supabase.rpc("quote_revise", { p_quote: id });
  if (error || !versionId) return fail(error?.message ?? "Could not revise");
  revalidatePath(`/quotes/${id}`);
  return { ok: true, data: { versionId } };
}

export async function addPricedService(quoteId: string, versionId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({
      rule_id: z.string().uuid(),
      state: z.enum(["included", "recommended", "optional"]).default("included"),
      section_id: z.string().uuid().optional().or(z.literal("")),
      option_group: z.string().optional().or(z.literal("")),
      option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { supabase, error: versionError } = await editableVersion(quoteId, versionId, session.orgId);
  if (versionError) return fail(versionError);
  const sectionId = parsed.data.section_id || null;
  if (sectionId) {
    const { data: section } = await supabase.from("quote_sections").select("id, version_id").eq("id", sectionId).eq("org_id", session.orgId).maybeSingle();
    if (!section || section.version_id !== versionId) return fail("Section not found");
  }

  const [{ data: quote, error: quoteError }, { data: rule, error: ruleError }, { data: org, error: orgError }] =
    await Promise.all([
      supabase.from("quotes").select("property_id, account_id").eq("id", quoteId).eq("org_id", session.orgId).maybeSingle(),
      supabase
        .from("pricing_rules")
        .select("name, config, service_id, price_list_id")
        .eq("id", parsed.data.rule_id)
        .eq("org_id", session.orgId)
        .eq("active", true)
        .maybeSingle(),
      supabase.from("orgs").select("settings").eq("id", session.orgId).maybeSingle(),
    ]);
  if (quoteError) return fail(quoteError.message);
  if (!quote) return fail("Quote not found");
  if (ruleError) return fail(ruleError.message);
  if (!rule) return fail("Pricing rule not found");
  if (orgError) return fail(orgError.message);

  const { data: list, error: listError } = await supabase
    .from("price_lists")
    .select("modifiers, status")
    .eq("id", rule.price_list_id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (listError) return fail(listError.message);
  if (!list) return fail("Price list not found");
  if (list.status !== "active") return fail("Price list is not active");

  let features: MeasuredFeature[] = [];
  let property: PropertyPricingInput | null = null;
  let quantitySource: "measurement" | "manual" | "unknown" = "unknown";
  if (quote.property_id) {
    const [{ data: propertyRow, error: propertyError }, { data: measurement, error: measurementError }] = await Promise.all([
      supabase
        .from("properties")
        .select("lot_sqft, slope, gate_width_in, obstacle_count, has_stairs")
        .eq("id", quote.property_id)
        .eq("org_id", session.orgId)
        .maybeSingle(),
      supabase
        .from("measurements")
        .select("confidence, measurement_features(category, area_sqft, length_ft)")
        .eq("property_id", quote.property_id)
        .eq("status", "current")
        .maybeSingle(),
    ]);
    if (propertyError) return fail(propertyError.message);
    if (!propertyRow) return fail("Property not found");
    if (measurementError) return fail(measurementError.message);
    features = measurement?.measurement_features ?? [];
    quantitySource = measurement ? "measurement" : "unknown";
    property = {
      lotSqft: propertyRow?.lot_sqft,
      slope: propertyRow?.slope,
      gateWidthIn: propertyRow?.gate_width_in,
      obstacleCount: propertyRow?.obstacle_count,
      hasStairs: propertyRow?.has_stairs,
      confidence: measurement?.confidence != null ? Number(measurement.confidence) : undefined,
    };
  }

  const priced = priceCatalogLine({
    config: rule.config,
    modifiers: mergeModifiers(list.modifiers),
    features,
    property,
  });
  if (!priced.ok) return fail(priced.error);

  const siteCheckReasons = autoSiteCheckReasons({
    confidence: property?.confidence,
    threshold: orgSiteCheckThreshold(org?.settings),
  });

  const { data, error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
    section_id: sectionId,
    service_id: rule.service_id,
    name: rule.name,
    price: priced.priced.price,
    hours: priced.priced.hours,
    cost: priced.priced.cost,
    range_low: priced.priced.range?.low ?? null,
    range_high: priced.priced.range?.high ?? null,
    state: parsed.data.state,
    option_group: parsed.data.option_group || null,
    option_tier: parsed.data.option_tier,
    selected: parsed.data.state === "included",
    quantity_source: quantitySource,
    site_check_reasons: siteCheckReasons,
  }).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function flagLineNeedsSiteCheck(
  quoteId: string,
  lineId: string,
  fd: FormData,
): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({
      enabled: z.enum(["true", "false"]),
      note: z.string().trim().max(2000).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { supabase, error: lineError } = await editableLine(quoteId, lineId, session.orgId);
  if (lineError) return fail(lineError);

  const { data: line, error: readError } = await supabase
    .from("quote_line_items")
    .select("id, site_check_reasons, price_locked")
    .eq("id", lineId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (readError) return fail(readError.message);
  if (!line) return fail("Line item not found");
  if (line.price_locked) return fail("This line is already locked at a verified price.");

  const reasons = mergeSiteCheckReasons(line.site_check_reasons, parsed.data.enabled === "true" ? "manual" : null);
  const { data, error } = await supabase
    .from("quote_line_items")
    .update({ site_check_reasons: reasons })
    .eq("id", lineId)
    .eq("org_id", session.orgId)
    .select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;

  const { data: quote } = await supabase
    .from("quotes")
    .select("account_id, property_id")
    .eq("id", quoteId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (quote) {
    const note = parsed.data.note?.trim();
    await supabase.from("activities").insert({
      org_id: session.orgId,
      account_id: quote.account_id,
      property_id: quote.property_id,
      kind: parsed.data.enabled === "true" ? "line.site_check_flagged" : "line.site_check_cleared",
      summary:
        parsed.data.enabled === "true"
          ? `Needs site check${note ? `: ${note}` : ""}`
          : "Cleared Needs site check",
      actor_id: session.userId,
      meta: { quote_id: quoteId, line_id: lineId, note: note || null },
    });
  }

  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function waiveLineSiteCheck(quoteId: string, lineId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({ reason: z.string().trim().min(1, "Add a reason.").max(2000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { supabase, error: lineError } = await editableLine(quoteId, lineId, session.orgId);
  if (lineError) return fail(lineError);

  const { data: line, error: readError } = await supabase
    .from("quote_line_items")
    .select("id, site_check_reasons, price, price_locked")
    .eq("id", lineId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (readError) return fail(readError.message);
  if (!line) return fail("Line item not found");
  if (line.price_locked) return fail("This line is already locked at a verified price.");
  if (!(line.site_check_reasons?.length)) return fail("This line does not need a site check.");

  const { data, error } = await supabase
    .from("quote_line_items")
    .update({
      site_check_reasons: [],
      range_low: null,
      range_high: null,
      price_locked: true,
      verified_price: Number(line.price),
      verified_at: new Date().toISOString(),
    })
    .eq("id", lineId)
    .eq("org_id", session.orgId)
    .select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;

  const { data: quote } = await supabase
    .from("quotes")
    .select("account_id, property_id")
    .eq("id", quoteId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (quote) {
    await supabase.from("activities").insert({
      org_id: session.orgId,
      account_id: quote.account_id,
      property_id: quote.property_id,
      kind: "line.site_check_waived",
      summary: `Priced as firm: ${parsed.data.reason}`,
      actor_id: session.userId,
      meta: { quote_id: quoteId, line_id: lineId, reason: parsed.data.reason, verified_price: Number(line.price) },
    });
  }

  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function approveSiteCheckRequest(quoteId: string, siteCheckId: string): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("site_check_approve", { p_id: siteCheckId });
  if (error) return fail(error.message);
  const body = data && typeof data === "object" ? (data as { ok?: boolean }) : {};
  if (body.ok !== true) return fail("Could not approve this request");

  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { ok: true };
}

export async function declineSiteCheckRequest(
  quoteId: string,
  siteCheckId: string,
  fd: FormData,
): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = z
    .object({ reason: z.string().trim().min(1, "Add a reason.").max(2000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("site_check_decline", {
    p_id: siteCheckId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);
  const body = data && typeof data === "object" ? (data as { ok?: boolean }) : {};
  if (body.ok !== true) return fail("Could not decline this request");

  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { ok: true };
}
