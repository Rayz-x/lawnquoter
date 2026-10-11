"use server";

import { revalidatePath } from "next/cache";
import { CATALOG_VERSION, buildCatalogRule, catalogEntry, pricingRuleSchema } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { seasonDates } from "./catalog-season";

const DENIED = "Only an owner or admin can change pricing.";

const selectionSchema = z
  .array(z.object({ key: z.string().min(1).max(60), price: z.number().positive().max(100000) }))
  .min(1, "Pick at least one service.")
  .max(60);

export async function installCatalogServices(
  selections: { key: string; price: number }[],
): Promise<ActionResult<{ installed: number; skipped: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return fail(DENIED);
  const parsed = selectionSchema.safeParse(selections);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the selected services");

  const now = new Date();
  const entries = [];
  for (const [i, pick] of parsed.data.entries()) {
    const entry = catalogEntry(pick.key);
    if (!entry) return fail("That service is not in the catalog.");
    const rule = pricingRuleSchema.safeParse(buildCatalogRule(entry, pick.price));
    if (!rule.success) return fail(`${entry.name}: ${rule.error.issues[0]?.message ?? "invalid price"}`);
    entries.push({
      key: entry.key,
      version: CATALOG_VERSION,
      name: entry.name,
      kind: entry.kind,
      description: entry.description,
      crew_task_name: entry.crewTask,
      taxable: entry.taxable,
      is_material: entry.isMaterial,
      sort: i,
      ...seasonDates(entry.season, now),
      config: rule.data,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("install_catalog_services", { p_entries: entries });
  if (error) return fail(error.message);
  const body = (data ?? {}) as { ok?: boolean; installed?: number; skipped?: number };
  if (body.ok !== true) return fail("Could not add these services");
  revalidatePath("/settings/pricing");
  return { ok: true, data: { installed: body.installed ?? 0, skipped: body.skipped ?? 0 } };
}

export async function activateCatalogDraft(priceListId: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return fail(DENIED);
  const id = z.string().uuid().safeParse(priceListId);
  if (!id.success) return fail("Invalid price list");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_price_list", { p_id: id.data });
  if (error) return fail(error.message);
  if ((data as { ok?: boolean } | null)?.ok !== true) return fail("Could not activate the price list");
  revalidatePath("/settings/pricing");
  return { ok: true };
}
