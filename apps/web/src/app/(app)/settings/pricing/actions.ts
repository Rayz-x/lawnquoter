"use server";

import { revalidatePath } from "next/cache";
import { mergeModifiers, modifiersSchema, parseMaterialsCsv, pricingRuleSchema, scaleModifiers, scaleRule } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
import { fieldsToModifiers, modifierFieldsSchema } from "./modifier-fields";
import { createClient } from "@/lib/supabase/server";

const SERVICE_KINDS = ["mowing", "fert", "cleanup", "snow", "irrigation", "install", "other"] as const;
const DENIED = "Only an owner or admin can change pricing.";
const NO_ROWS = "Nothing was saved. You may not have permission to change pricing.";

function path() {
  revalidatePath("/settings/pricing");
}

function denyPricing() {
  return fail(DENIED);
}

export async function createService(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(160),
      kind: z.enum(SERVICE_KINDS),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const slug = slugify(parsed.data.name) || "service";
  const { data, error } = await supabase
    .from("services")
    .insert({ org_id: session.orgId, name: parsed.data.name, kind: parsed.data.kind, slug: `${slug}-${crypto.randomUUID().slice(0, 6)}` })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create service");

  if (parsed.data.kind === "mowing") {
    const { data: list } = await supabase.from("price_lists").select("id").eq("org_id", session.orgId).eq("status", "active").single();
    if (list) {
      await supabase.from("pricing_rules").insert({
        org_id: session.orgId,
        price_list_id: list.id,
        service_id: data.id,
        name: "Mowing tiers",
        rule_type: "tier_matrix",
        config: {
          type: "tier_matrix",
          quantityKey: "turf_sqft",
          rows: [
            { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
            { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
            { upTo: null, price: 70, hours: 1, cost: 32 },
          ],
          tail: { every: 1000, over: 15000, addPrice: 5, addHours: 0.08, addCost: 2 },
        },
      });
    }
  }
  path();
  return { ok: true, data: { id: data.id } };
}

const optionalIsoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal(""));

export async function updateService(fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const parsed = z
    .object({
      id: z.string().uuid(),
      description: z.string().trim().max(2000).optional(),
      window_start: optionalIsoDate,
      window_end: optionalIsoDate,
      warn_date: optionalIsoDate,
      minimum_price: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const windowStart = parsed.data.window_start || null;
  const windowEnd = parsed.data.window_end || null;
  const warnDate = parsed.data.warn_date || null;
  const anyWindow = Boolean(windowStart || windowEnd || warnDate);
  if (anyWindow && !(windowStart && windowEnd && warnDate)) {
    return fail("Set window start, warn date, and window end together — or clear all three.");
  }
  if (windowStart && warnDate && windowStart > warnDate) {
    return fail("Warn date must be on or after the window start.");
  }
  if (warnDate && windowEnd && warnDate > windowEnd) {
    return fail("Warn date must be on or before the window end.");
  }

  const minimumRaw = parsed.data.minimum_price;
  const minimumPrice = minimumRaw == null || minimumRaw === "" ? null : Number(minimumRaw);
  if (minimumRaw != null && minimumRaw !== "" && (minimumPrice == null || !Number.isFinite(minimumPrice) || minimumPrice < 0 || minimumPrice > 100000)) {
    return fail("Enter a service minimum of $0 or more.");
  }
  const patch: {
    description?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    warn_date?: string | null;
    minimum_price?: number | null;
  } = {};
  if (parsed.data.description !== undefined) {
    patch.description = parsed.data.description || null;
  }
  if (minimumRaw !== undefined) patch.minimum_price = minimumPrice;
  if (
    parsed.data.window_start !== undefined ||
    parsed.data.window_end !== undefined ||
    parsed.data.warn_date !== undefined
  ) {
    patch.window_start = windowStart;
    patch.window_end = windowEnd;
    patch.warn_date = warnDate;
  }
  if (Object.keys(patch).length === 0) return fail("Nothing to update");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("org_id", session.orgId)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(NO_ROWS);
  path();
  return { ok: true };
}

export async function toggleService(id: string, active: boolean): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").update({ active }).eq("id", id).eq("org_id", session.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(NO_ROWS);
  path();
  return { ok: true };
}

export async function saveRule(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const raw = Object.fromEntries(fd);
  let config: unknown;
  try {
    config = JSON.parse(String(raw.config ?? "{}"));
  } catch {
    return fail("Rule config must be valid JSON");
  }
  const parsed = z
    .object({
      id: z.string().uuid().optional().or(z.literal("")),
      service_id: z.string().uuid(),
      price_list_id: z.string().uuid(),
      name: z.string().trim().min(1).max(160),
    })
    .safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const rule = pricingRuleSchema.safeParse(config);
  if (!rule.success) return fail(rule.error.issues[0]?.message ?? "Invalid rule");

  const supabase = await createClient();
  const row = {
    org_id: session.orgId,
    price_list_id: parsed.data.price_list_id,
    service_id: parsed.data.service_id,
    name: parsed.data.name,
    rule_type: rule.data.type,
    config: rule.data,
  };
  if (parsed.data.id) {
    const { data, error } = await supabase.from("pricing_rules").update(row).eq("id", parsed.data.id).eq("org_id", session.orgId).select("id");
    if (error) return fail(error.message);
    if (!data?.length) return fail(NO_ROWS);
    path();
    return { ok: true, data: { id: parsed.data.id } };
  }
  const { data, error } = await supabase.from("pricing_rules").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not save rule");
  path();
  return { ok: true, data: { id: data.id } };
}

const RAISE_PERCENT_ERROR = "Enter a percent from -50 to 100, other than zero.";
const PARTIAL_SAVE = "Prices were partly updated, then a save failed. Check this list before trying again.";

/** Move every dollar on one price list by a percent. Hours and percents stay put. Nothing is written if a rule cannot be read. */
export async function raiseAllPrices(priceListId: string, percent: number): Promise<ActionResult<{ count: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const listId = z.string().uuid().safeParse(priceListId);
  if (!listId.success) return fail("Invalid price list");
  if (!Number.isFinite(percent) || percent === 0 || percent < -50 || percent > 100) return fail(RAISE_PERCENT_ERROR);
  const factor = 1 + percent / 100;
  const supabase = await createClient();
  const { data, error } = await supabase.from("pricing_rules").select("id, config").eq("price_list_id", listId.data).eq("org_id", session.orgId);
  if (error) return fail(error.message);
  const scaled = [];
  for (const row of data ?? []) {
    const rule = pricingRuleSchema.safeParse(row.config);
    if (!rule.success) return fail("One price could not be read, so nothing was changed.");
    scaled.push({ id: row.id, config: scaleRule(rule.data, factor) });
  }
  const { data: list, error: listError } = await supabase
    .from("price_lists")
    .select("modifiers")
    .eq("id", listId.data)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (listError) return fail(listError.message);
  if (!list) return fail(NO_ROWS);
  const modifiers = modifiersSchema.safeParse(scaleModifiers(mergeModifiers(list.modifiers), factor));
  if (!modifiers.success) return fail("Property adjustments could not be read, so nothing was changed.");

  const { data: savedList, error: listUpdateError } = await supabase
    .from("price_lists")
    .update({ modifiers: modifiers.data })
    .eq("id", listId.data)
    .eq("org_id", session.orgId)
    .select("id");
  if (listUpdateError) return fail(listUpdateError.message);
  if (!savedList?.length) return fail(NO_ROWS);
  for (const row of scaled) {
    const { data: saved, error: updateError } = await supabase
      .from("pricing_rules")
      .update({ rule_type: row.config.type, config: row.config })
      .eq("id", row.id)
      .eq("org_id", session.orgId)
      .select("id");
    if (updateError || !saved?.length) return fail(PARTIAL_SAVE);
  }
  path();
  return { ok: true, data: { count: scaled.length } };
}

export async function deleteRule(id: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const supabase = await createClient();
  const { data, error } = await supabase.from("pricing_rules").delete().eq("id", id).eq("org_id", session.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(NO_ROWS);
  path();
  return { ok: true };
}

/** Owners edit plain dollars, percents and minutes. The server maps them to the engine's modifiers. */
export async function saveModifiers(priceListId: string, fields: unknown): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const parsedFields = modifierFieldsSchema.safeParse(fields);
  if (!parsedFields.success) return fail(parsedFields.error.issues[0]?.message ?? "Check the highlighted values");
  const parsed = modifiersSchema.safeParse(fieldsToModifiers(parsedFields.data));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid modifiers");
  const listId = z.string().uuid().safeParse(priceListId);
  if (!listId.success) return fail("Invalid price list");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_lists")
    .update({ modifiers: parsed.data })
    .eq("id", listId.data)
    .eq("org_id", session.orgId)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(NO_ROWS);
  path();
  return { ok: true };
}

export async function importMaterialsCsv(fd: FormData): Promise<ActionResult<{ count: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const csv = String(fd.get("csv") ?? "");
  const rows = parseMaterialsCsv(csv);
  if (rows.length === 0) return fail("No materials found. The first row needs a Name column and a Cost column.");
  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert(
    rows.map((r) => ({
      org_id: session.orgId,
      sku: r.sku || null,
      name: r.name,
      unit: r.unit,
      unit_cost: r.unitCost,
    })),
  );
  if (error) return fail(error.message);
  path();
  return { ok: true, data: { count: rows.length } };
}

export async function addMaterial(fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(160),
      sku: z.string().trim().max(60).optional().or(z.literal("")),
      unit: z.string().trim().min(1).max(20).default("each"),
      unit_cost: z.coerce.number().nonnegative(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert({
    org_id: session.orgId,
    name: parsed.data.name,
    sku: parsed.data.sku || null,
    unit: parsed.data.unit,
    unit_cost: parsed.data.unit_cost,
  });
  if (error) return fail(error.message);
  path();
  return { ok: true };
}
