"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { bulkMeasuredSqft, isBidFrequency, isBidStatus } from "@/lib/bids/package";
import { parseTakeoff } from "@/lib/bids/takeoff";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

async function salesClient() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return { session, supabase: null as null };
  return { session, supabase: await createClient() };
}

export async function createBidPackage(formData: FormData) {
  const { session, supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can create bid packages.");
  const accountId = String(formData.get("account_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Name the bid package.");
  const { data, error } = await supabase
    .from("bid_packages")
    .insert({
      org_id: session.orgId,
      account_id: accountId,
      title,
      due_on: String(formData.get("due_on") ?? "") || null,
      walk_on: String(formData.get("walk_on") ?? "") || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the package.");
  revalidatePath("/bids");
  redirect(`/bids/${data.id}`);
}

export async function setBidStatus(formData: FormData): Promise<void> {
  const { supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can update a bid.");
  const status = String(formData.get("status") ?? "");
  if (!isBidStatus(status)) throw new Error("Choose a bid status.");
  const id = String(formData.get("package_id") ?? "");
  const { error } = await supabase.from("bid_packages").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/bids/${id}`);
}

export async function addBidLine(formData: FormData): Promise<void> {
  const { session, supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can add spec lines.");
  const frequency = String(formData.get("frequency") ?? "once");
  if (!isBidFrequency(frequency)) throw new Error("Choose a frequency.");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name the line.");
  const packageId = String(formData.get("package_id") ?? "");
  const { error } = await supabase.from("bid_lines").insert({
    org_id: session.orgId,
    package_id: packageId,
    name,
    unit: String(formData.get("unit") ?? "each").trim() || "each",
    unit_price: Number(formData.get("unit_price") ?? 0),
    qty: Number(formData.get("qty") ?? 1),
    frequency,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/bids/${packageId}`);
}

export async function addPortfolioSites(formData: FormData): Promise<void> {
  const { session, supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can add sites.");
  const packageId = String(formData.get("package_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const { data: children } = await supabase.from("accounts").select("id").eq("parent_account_id", accountId);
  const accountIds = [accountId, ...(children ?? []).map((row) => row.id)];
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id")
    .in("account_id", accountIds)
    .limit(200);
  if (error) throw new Error(error.message);
  if (!properties?.length) throw new Error("That portfolio has no properties yet.");
  const { error: insertError } = await supabase.from("bid_sites").upsert(
    properties.map((property) => ({
      org_id: session.orgId,
      package_id: packageId,
      property_id: property.id,
    })),
    { onConflict: "package_id,property_id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(insertError.message);
  revalidatePath(`/bids/${packageId}`);
}

export async function applyBulkMeasure(formData: FormData): Promise<void> {
  const { supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can measure sites.");
  const packageId = String(formData.get("package_id") ?? "");
  const overrideRaw = String(formData.get("sqft") ?? "").trim();
  const override = overrideRaw ? Number(overrideRaw) : null;
  if (override != null && !Number.isFinite(override)) throw new Error("Enter a square-foot measurement.");
  const { data: sites, error } = await supabase
    .from("bid_sites")
    .select("id, property_id")
    .eq("package_id", packageId);
  if (error) throw new Error(error.message);
  const propertyIds = (sites ?? []).map((site) => site.property_id);
  const { data: properties } = propertyIds.length
    ? await supabase.from("properties").select("id, lot_sqft").in("id", propertyIds)
    : { data: [] };
  const lots = new Map((properties ?? []).map((property) => [property.id, property.lot_sqft]));
  const measured = bulkMeasuredSqft(
    (sites ?? []).map((site) => ({ id: site.id, lotSqft: lots.get(site.property_id) ?? null })),
    override,
  );
  for (const site of measured) {
    const { error: updateError } = await supabase
      .from("bid_sites")
      .update({ measured_sqft: site.measuredSqft })
      .eq("id", site.id);
    if (updateError) throw new Error(updateError.message);
  }
  revalidatePath(`/bids/${packageId}`);
}

export async function importTakeoff(formData: FormData): Promise<void> {
  const { session, supabase } = await salesClient();
  if (!supabase) throw new Error("Sales can import a takeoff.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a GeoJSON or spreadsheet file.");
  const parsed = parseTakeoff(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!parsed.ok) throw new Error(parsed.error);
  const packageId = String(formData.get("package_id") ?? "");
  const { error } = await supabase.from("takeoff_imports").insert({
    org_id: session.orgId,
    package_id: packageId,
    filename: file.name.slice(0, 200),
    kind: parsed.kind,
    feature_count: parsed.featureCount,
    area_sqft: parsed.areaSqft,
  });
  if (error) throw new Error(error.message);
  const { error: lineError } = await supabase.from("bid_lines").insert(
    parsed.lines.map((line, index) => ({
      org_id: session.orgId,
      package_id: packageId,
      name: line.name.slice(0, 200),
      unit: line.unit.slice(0, 40),
      qty: line.qty,
      sort: index,
    })),
  );
  if (lineError) throw new Error(lineError.message);
  revalidatePath(`/bids/${packageId}`);
}

export async function addSiteWalkNote(formData: FormData): Promise<void> {
  const session = await requireOrg();
  const supabase = await createClient();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Write a note.");
  const packageId = String(formData.get("package_id") ?? "");
  const lat = Number(formData.get("lat") ?? "");
  const lng = Number(formData.get("lng") ?? "");
  const { error } = await supabase.from("site_walk_notes").insert({
    org_id: session.orgId,
    package_id: packageId,
    property_id: String(formData.get("property_id") ?? "") || null,
    body,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    created_by: session.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/crew/walk");
  revalidatePath(`/bids/${packageId}`);
}
