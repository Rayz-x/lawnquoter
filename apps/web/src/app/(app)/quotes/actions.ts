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

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  state: z.enum(["included", "recommended", "optional"]).default("included"),
  option_group: z.string().max(80).optional().or(z.literal("")),
  option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
  qty: z.coerce.number().positive().default(1),
  unit: z.string().max(20).default("each"),
  price: z.coerce.number().nonnegative().default(0),
  hours: z.coerce.number().nonnegative().default(0),
  cost: z.coerce.number().nonnegative().default(0),
  range_low: z.coerce.number().nonnegative().optional().or(z.literal("")),
  range_high: z.coerce.number().nonnegative().optional().or(z.literal("")),
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

export async function addLineItem(quoteId: string, versionId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const denied = denyUnlessSales(session.orgRole);
  if (denied) return denied;
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { supabase, error: versionError } = await editableVersion(quoteId, versionId, session.orgId);
  if (versionError) return fail(versionError);
  const { data, error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
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
    range_low: parsed.data.range_low === "" || parsed.data.range_low == null ? null : Number(parsed.data.range_low),
    range_high: parsed.data.range_high === "" || parsed.data.range_high == null ? null : Number(parsed.data.range_high),
    photo_url: parsed.data.photo_url || null,
    notes_customer: parsed.data.notes_customer || null,
    notes_crew: parsed.data.notes_crew || null,
    selected: parsed.data.state === "included",
  }).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
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
  const patch = copyEditable
    ? {
        title: parsed.data.title,
        intro: parsed.data.intro || null,
        notes_customer: parsed.data.notes_customer || null,
        notes_internal: parsed.data.notes_internal || null,
      }
    : { notes_internal: parsed.data.notes_internal || null };
  if (copyEditable && !patch.title) return fail("Title is required");
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
      option_group: z.string().optional().or(z.literal("")),
      option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { supabase, error: versionError } = await editableVersion(quoteId, versionId, session.orgId);
  if (versionError) return fail(versionError);

  const [{ data: quote, error: quoteError }, { data: rule, error: ruleError }] = await Promise.all([
    supabase.from("quotes").select("property_id").eq("id", quoteId).eq("org_id", session.orgId).maybeSingle(),
    supabase
      .from("pricing_rules")
      .select("name, config, service_id, price_list_id")
      .eq("id", parsed.data.rule_id)
      .eq("org_id", session.orgId)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (quoteError) return fail(quoteError.message);
  if (!quote) return fail("Quote not found");
  if (ruleError) return fail(ruleError.message);
  if (!rule) return fail("Pricing rule not found");

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

  const { data, error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
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
  }).select("id");
  const missed = unchanged(data, error);
  if (missed) return missed;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}
