"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole } from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const conditionsSchema = z.object({ slope: z.enum(["flat", "gentle", "moderate", "steep"]).nullable(), gate_width_in: z.number().int().min(12).max(240).nullable(), obstacle_count: z.number().int().min(0).max(50), has_stairs: z.boolean() });
const accessSchema = z.object({ has_dogs: z.boolean().optional(), crew_notes: z.string().trim().max(2000).nullable().optional(), access_notes: z.string().trim().max(2000).nullable().optional(), gate_code: z.string().trim().max(32).nullable().optional() });
const metaSchema = z.object({ name: z.string().trim().max(120).nullable().optional(), zone: z.string().trim().max(60).nullable().optional() });
const addressSchema = z.object({ address_line1: z.string().trim().min(1).max(200), city: z.string().trim().min(1).max(100), region: z.string().trim().min(2).max(100), postal_code: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/) });
const DENIED = "You don't have permission to edit properties.";
const MISSING = "Property not found";

async function loadProperty(id: string) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return { session, supabase: null, property: null, denied: true };
  const supabase = await createClient();
  const { data } = await supabase.from("properties").select("id, account_id").eq("id", id).eq("org_id", session.orgId).maybeSingle();
  return { session, supabase, property: data, denied: false };
}

function refresh(id: string, accountId: string) {
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/accounts/${accountId}`);
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<ActionResult> {
  const loaded = await loadProperty(id);
  if (loaded.denied || !loaded.supabase) return fail(DENIED);
  if (!loaded.property) return fail(MISSING);
  const { data, error } = await loaded.supabase.from("properties").update(patch as never).eq("id", id).eq("org_id", loaded.session.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(MISSING);
  refresh(id, loaded.property.account_id);
  return { ok: true };
}

export async function updatePropertyConditions(id: string, input: z.infer<typeof conditionsSchema>): Promise<ActionResult> {
  const parsed = conditionsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  return updateRow(id, parsed.data);
}

export async function updatePropertyAccess(id: string, input: z.infer<typeof accessSchema>): Promise<ActionResult> {
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const loaded = await loadProperty(id);
  if (loaded.denied) return fail(DENIED);
  if (!loaded.property) return fail(MISSING);
  const patch: { has_dogs?: boolean; crew_notes?: string | null } = {};
  if (parsed.data.has_dogs !== undefined) patch.has_dogs = parsed.data.has_dogs;
  if (parsed.data.crew_notes !== undefined) patch.crew_notes = parsed.data.crew_notes || null;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await loaded.supabase.from("properties").update(patch).eq("id", id).eq("org_id", loaded.session.orgId).select("id");
    if (error) return fail(error.message);
    if (!data?.length) return fail(MISSING);
  }
  if (parsed.data.gate_code !== undefined || parsed.data.access_notes !== undefined) {
    const { data: existing } = await loaded.supabase.from("property_access").select("gate_code, access_notes").eq("property_id", id).eq("org_id", loaded.session.orgId).maybeSingle();
    const gate_code = parsed.data.gate_code !== undefined ? parsed.data.gate_code || null : (existing?.gate_code ?? null);
    const access_notes = parsed.data.access_notes !== undefined ? parsed.data.access_notes || null : (existing?.access_notes ?? null);
    const clearing = !gate_code && !access_notes;
    const write = clearing ? loaded.supabase.from("property_access").delete().eq("property_id", id).eq("org_id", loaded.session.orgId).select("property_id") : loaded.supabase.from("property_access").upsert({ property_id: id, org_id: loaded.session.orgId, gate_code, access_notes }, { onConflict: "property_id" }).select("property_id");
    const { data, error } = await write;
    if (error) return fail(error.message);
    if (!data?.length && !(clearing && !existing)) return fail(MISSING);
  }
  refresh(id, loaded.property.account_id);
  return { ok: true };
}

export async function updatePropertyMeta(id: string, input: z.infer<typeof metaSchema>): Promise<ActionResult> {
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const patch: { name?: string | null; zone?: string | null } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name || null;
  if (parsed.data.zone !== undefined) patch.zone = parsed.data.zone || null;
  return Object.keys(patch).length === 0 ? { ok: true } : updateRow(id, patch);
}

export async function updatePropertyAddress(id: string, input: z.infer<typeof addressSchema>): Promise<ActionResult> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter the address as Street, City, ST ZIP.");
  const loaded = await loadProperty(id);
  if (loaded.denied || !loaded.supabase) return fail(DENIED);
  const row = await updateRow(id, { ...parsed.data, formatted_address: null });
  if (!row.ok) return row;
  const cleared = await loaded.supabase.rpc("property_clear_geometry", { p_property: id });
  return cleared.error ? fail(cleared.error.message) : { ok: true };
}

export async function placePropertyPin(id: string, [lng, lat]: [number, number]): Promise<ActionResult> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return fail("Drop the pin on the map.");
  const loaded = await loadProperty(id);
  if (loaded.denied) return fail(DENIED);
  if (!loaded.property) return fail(MISSING);
  const { error } = await loaded.supabase.rpc("property_set_geometry", { p_property: id, p_location: { type: "Point", coordinates: [lng, lat] } });
  if (error) return fail(error.message);
  refresh(id, loaded.property.account_id);
  return { ok: true };
}

export async function archiveProperty(id: string): Promise<ActionResult> {
  const loaded = await loadProperty(id);
  if (loaded.denied) return fail(DENIED);
  if (!loaded.property) return fail(MISSING);
  const row = await updateRow(id, { is_active: false });
  if (!row.ok) return row;
  redirect(`/accounts/${loaded.property.account_id}`);
}
