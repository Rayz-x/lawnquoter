"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { requireOrg } from "@/lib/auth/session";
import { emptyToNull, fail, type ActionResult } from "@/lib/actions/result";
import { resolvePropertyGeo } from "@/lib/geo/resolve";
import { parseLeadSource } from "@/lib/leads/lead-source";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const accountSchema = z.object({
  type: z.enum(["residential", "commercial"]),
  status: z.enum(["lead", "active", "inactive"]).default("lead"),
  name: z.string().trim().min(1).max(200),
  company_name: optionalText(200),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: optionalText(40),
  billing_email: z.string().trim().email().optional().or(z.literal("")),
  net_terms_days: z.coerce.number().int().min(0).max(120).default(0),
  po_required: z.coerce.boolean().default(false),
  tax_exempt: z.coerce.boolean().default(false),
  consolidated_invoicing: z.coerce.boolean().default(false),
  parent_account_id: z.string().uuid().optional().or(z.literal("")),
  lead_source: optionalText(40),
  lead_source_other: optionalText(100),
  notes: optionalText(5000),
});

function leadFields(source: string | undefined, other: string | undefined) {
  const parsed = parseLeadSource(source ?? "", other ?? "");
  if (!parsed.ok) return parsed;
  return {
    ok: true as const,
    lead_source: parsed.lead_source,
    lead_source_other: parsed.lead_source_other,
  };
}

async function requireAccountEditor() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return null;
  return session;
}

function checkbox(fd: FormData, name: string) {
  return fd.get(name) === "on" || fd.get(name) === "true";
}

function parseAccount(fd: FormData) {
  const raw = Object.fromEntries(fd);
  return accountSchema.safeParse({
    ...raw,
    po_required: checkbox(fd, "po_required"),
    tax_exempt: checkbox(fd, "tax_exempt"),
    consolidated_invoicing: checkbox(fd, "consolidated_invoicing"),
  });
}

export async function createAccount(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireAccountEditor();
  if (!session) return fail("You don't have permission to edit customers.");
  const parsed = parseAccount(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const lead = leadFields(parsed.data.lead_source, parsed.data.lead_source_other);
  if (!lead.ok) return fail(lead.error);
  const { lead_source: _ls, lead_source_other: _lso, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      ...emptyToNull(rest),
      lead_source: lead.lead_source,
      lead_source_other: lead.lead_source_other,
      org_id: session.orgId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  await supabase.from("activities").insert({
    org_id: session.orgId,
    account_id: data.id,
    kind: "account.created",
    summary: `Account created (${parsed.data.type})`,
    actor_id: session.userId,
  });
  revalidatePath("/accounts");
  return { ok: true, data: { id: data.id } };
}

export async function updateAccount(id: string, fd: FormData): Promise<ActionResult> {
  const session = await requireAccountEditor();
  if (!session) return fail("You don't have permission to edit customers.");
  const parsed = parseAccount(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const lead = leadFields(parsed.data.lead_source, parsed.data.lead_source_other);
  if (!lead.ok) return fail(lead.error);
  const { lead_source: _ls, lead_source_other: _lso, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({
      ...emptyToNull(rest),
      lead_source: lead.lead_source,
      lead_source_other: lead.lead_source_other,
    })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Could not save. You may not have permission, or this record changed.");
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true };
}

const contactSchema = z.object({
  first_name: z.string().trim().max(100).default(""),
  last_name: z.string().trim().max(100).default(""),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: optionalText(40),
  role: z.enum(["primary", "billing", "site", "decision_maker", "other"]).default("primary"),
  title: optionalText(100),
  is_primary: z.boolean().default(false),
  is_billing: z.boolean().default(false),
  sms_opt_in: z.boolean().default(false),
});

export async function addContact(accountId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireAccountEditor();
  if (!session) return fail("You don't have permission to edit customers.");
  const parsed = contactSchema.safeParse({
    ...Object.fromEntries(fd),
    is_primary: checkbox(fd, "is_primary"),
    is_billing: checkbox(fd, "is_billing"),
    sms_opt_in: checkbox(fd, "sms_opt_in"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  if (!parsed.data.first_name && !parsed.data.last_name && !parsed.data.email && !parsed.data.phone) {
    return fail("Enter at least a name, email or phone.");
  }
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!account) return fail("Account not found");
  if (parsed.data.is_primary) {
    await supabase.from("contacts").update({ is_primary: false }).eq("account_id", accountId).eq("is_primary", true);
  }
  const { error } = await supabase
    .from("contacts")
    .insert({ ...emptyToNull(parsed.data), org_id: session.orgId, account_id: accountId });
  if (error) return fail(error.message);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function deleteContact(accountId: string, contactId: string): Promise<ActionResult> {
  const session = await requireAccountEditor();
  if (!session) return fail("You don't have permission to edit customers.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("contacts").delete().eq("id", contactId).eq("org_id", session.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Could not save. You may not have permission, or this record changed.");
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

const propertySchema = z.object({
  name: optionalText(120),
  address_line1: z.string().trim().min(1).max(200),
  address_line2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postal_code: z.string().trim().min(1).max(20),
  gate_width_in: z.coerce.number().int().min(0).max(240).optional().or(z.literal("")),
  slope: z.enum(["flat", "gentle", "moderate", "steep"]).optional().or(z.literal("")),
  has_stairs: z.boolean().default(false),
  has_dogs: z.boolean().default(false),
  obstacle_count: z.coerce.number().int().min(0).default(0),
  access_notes: optionalText(2000),
  crew_notes: optionalText(2000),
  gate_code: optionalText(40),
  zone: optionalText(60),
});

type PropertyValues = Omit<z.infer<typeof propertySchema>, "slope" | "gate_width_in" | "gate_code" | "access_notes"> & {
  slope: "flat" | "gentle" | "moderate" | "steep" | null;
  gate_width_in: number | null;
};

type PropertyAccessValues = { gate_code: string | null; access_notes: string | null };

function parseProperty(
  fd: FormData,
): { success: true; data: PropertyValues; access: PropertyAccessValues } | { success: false; error: string } {
  const parsed = propertySchema.safeParse({
    ...Object.fromEntries(fd),
    has_stairs: checkbox(fd, "has_stairs"),
    has_dogs: checkbox(fd, "has_dogs"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { slope, gate_width_in, gate_code, access_notes, ...rest } = parsed.data;
  const access = emptyToNull({ gate_code, access_notes });
  return {
    success: true,
    data: {
      ...emptyToNull(rest),
      slope: slope ? slope : null,
      gate_width_in: gate_width_in === "" || gate_width_in === undefined ? null : Number(gate_width_in),
    },
    access: {
      gate_code: access.gate_code ?? null,
      access_notes: access.access_notes ?? null,
    },
  };
}

/** Gate codes live in property_access so crew cannot read them from properties. */
async function savePropertyAccess(
  propertyId: string,
  orgId: string,
  access: PropertyAccessValues,
): Promise<string | null> {
  const supabase = await createClient();
  if (!access.gate_code && !access.access_notes) {
    const { error } = await supabase.from("property_access").delete().eq("property_id", propertyId).eq("org_id", orgId);
    return error?.message ?? null;
  }
  const { error } = await supabase.from("property_access").upsert(
    {
      property_id: propertyId,
      org_id: orgId,
      gate_code: access.gate_code,
      access_notes: access.access_notes,
    },
    { onConflict: "property_id" },
  );
  return error?.message ?? null;
}

/**
 * Creates a property, then resolves geocode -> parcel -> footprint and stores
 * the geometry. Geo providers are optional; the property is created either way.
 */
export async function createProperty(accountId: string, fd: FormData): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const session = await requireAccountEditor();
  if (!session) return fail("You don't have permission to edit customers.");
  const parsed = parseProperty(fd);
  if (!parsed.success) return fail(parsed.error);
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!account) return fail("Account not found");

  const { data, error } = await supabase
    .from("properties")
    .insert({ ...parsed.data, org_id: session.orgId, account_id: accountId })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const accessError = await savePropertyAccess(data.id, session.orgId, parsed.access);
  if (accessError) return fail(accessError);

  const warnings = await resolveAndStoreGeometry(data.id, parsed.data);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/properties");
  return { ok: true, data: { id: data.id, warnings } };
}

export async function updateProperty(id: string, fd: FormData): Promise<ActionResult<{ warnings: string[] }>> {
  const session = await requireOrg();
  const parsed = parseProperty(fd);
  if (!parsed.success) return fail(parsed.error);
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("properties")
    .select("address_line1, city, region, postal_code, account_id")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!before) return fail("Property not found");
  const { error } = await supabase
    .from("properties")
    .update({ ...parsed.data, formatted_address: null })
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return fail(error.message);
  const accessError = await savePropertyAccess(id, session.orgId, parsed.access);
  if (accessError) return fail(accessError);

  const addressChanged =
    before.address_line1 !== parsed.data.address_line1 ||
    before.city !== parsed.data.city ||
    before.region !== parsed.data.region ||
    before.postal_code !== parsed.data.postal_code;
  const warnings = addressChanged
    ? await resolveAndStoreGeometry(id, parsed.data, { clearOnMiss: addressChanged })
    : [];
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/accounts/${before.account_id}`);
  return { ok: true, data: { warnings } };
}

export async function regeocodeProperty(id: string): Promise<ActionResult<{ warnings: string[] }>> {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("address_line1, city, region, postal_code")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .single();
  if (!data) return fail("Property not found");
  const warnings = await resolveAndStoreGeometry(id, data);
  revalidatePath(`/properties/${id}`);
  return { ok: true, data: { warnings } };
}

async function resolveAndStoreGeometry(
  propertyId: string,
  addr: { address_line1: string; city: string; region: string; postal_code: string },
  options?: { clearOnMiss?: boolean },
): Promise<string[]> {
  const supabase = await createClient();
  const address = `${addr.address_line1}, ${addr.city}, ${addr.region} ${addr.postal_code}`;
  const geo = await resolvePropertyGeo(address);
  if (geo.geocode) {
    await supabase
      .from("properties")
      .update({ formatted_address: geo.geocode.formattedAddress, place_id: geo.geocode.placeId })
      .eq("id", propertyId);
    await supabase.rpc("property_set_geometry", {
      p_property: propertyId,
      p_location: geo.geocode.location,
      p_parcel: geo.parcel?.geometry ?? undefined,
      p_parcel_source: geo.parcel?.source ?? undefined,
      p_parcel_apn: geo.parcel?.apn ?? undefined,
      p_footprint: geo.footprint?.geometry ?? undefined,
      p_footprint_source: geo.footprint?.source ?? undefined,
    });
  } else if (options?.clearOnMiss) {
    const { error } = await supabase.rpc("property_clear_geometry", { p_property: propertyId });
    if (error) {
      return [
        ...geo.warnings,
        "Saved the new address, but the previous map pin could not be cleared.",
      ];
    }
  }
  return geo.warnings;
}
