"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrg } from "@/lib/auth/session";
import { emptyToNull, fail, type ActionResult } from "@/lib/actions/result";
import { resolvePropertyGeo } from "@/lib/geo/resolve";
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
  lead_source: optionalText(100),
  notes: optionalText(5000),
});

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
  const session = await requireOrg();
  const parsed = parseAccount(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({ ...emptyToNull(parsed.data), org_id: session.orgId, created_by: session.userId })
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
  const session = await requireOrg();
  const parsed = parseAccount(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update(emptyToNull(parsed.data))
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return fail(error.message);
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
  const session = await requireOrg();
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
  const session = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").delete().eq("id", contactId).eq("org_id", session.orgId);
  if (error) return fail(error.message);
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

type PropertyValues = Omit<z.infer<typeof propertySchema>, "slope" | "gate_width_in"> & {
  slope: "flat" | "gentle" | "moderate" | "steep" | null;
  gate_width_in: number | null;
};

function parseProperty(fd: FormData): { success: true; data: PropertyValues } | { success: false; error: string } {
  const parsed = propertySchema.safeParse({
    ...Object.fromEntries(fd),
    has_stairs: checkbox(fd, "has_stairs"),
    has_dogs: checkbox(fd, "has_dogs"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { slope, gate_width_in, ...rest } = parsed.data;
  return {
    success: true,
    data: {
      ...emptyToNull(rest),
      slope: slope ? slope : null,
      gate_width_in: gate_width_in === "" || gate_width_in === undefined ? null : Number(gate_width_in),
    },
  };
}

/**
 * Creates a property, then resolves geocode -> parcel -> footprint and stores
 * the geometry. Geo providers are optional; the property is created either way.
 */
export async function createProperty(accountId: string, fd: FormData): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const session = await requireOrg();
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

  const addressChanged =
    !before ||
    before.address_line1 !== parsed.data.address_line1 ||
    before.city !== parsed.data.city ||
    before.region !== parsed.data.region ||
    before.postal_code !== parsed.data.postal_code;
  const warnings = addressChanged || fd.get("regeocode") === "true" ? await resolveAndStoreGeometry(id, parsed.data) : [];
  revalidatePath(`/properties/${id}`);
  if (before) revalidatePath(`/accounts/${before.account_id}`);
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
  }
  return geo.warnings;
}

export async function deleteAccountAndRedirect(id: string): Promise<void> {
  const session = await requireOrg();
  const supabase = await createClient();
  await supabase.from("accounts").delete().eq("id", id).eq("org_id", session.orgId);
  revalidatePath("/accounts");
  redirect("/accounts");
}
