"use server";

import { revalidatePath } from "next/cache";
import { modifiersSchema, modifiersWithDefaults, parseMaterialsCsv, pricingRuleSchema } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
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

export async function updateService(fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  const parsed = z
    .object({
      id: z.string().uuid(),
      description: z.string().trim().max(2000),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update({ description: parsed.data.description || null })
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

export async function saveModifiers(fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return denyPricing();
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("modifiers") ?? "{}"));
  } catch {
    return fail("Modifiers must be valid JSON");
  }
  const parsed = modifiersSchema.safeParse(modifiersWithDefaults(raw));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid modifiers");
  const listId = String(fd.get("price_list_id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_lists")
    .update({ modifiers: parsed.data })
    .eq("id", listId)
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
  if (rows.length === 0) return fail("No material rows found. Need name and unit_cost columns.");
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
