"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { parseConvertLeadResult, type ConvertLeadResult } from "@/lib/leads/convert";
import { canEditLeads } from "@/lib/leads/detail";
import { lookupFootprint } from "@/lib/geo/footprint";
import { lookupParcel } from "@/lib/geo/parcel";
import { createClient } from "@/lib/supabase/server";

async function queueParcelFootprint(propertyId: string) {
  const supabase = await createClient();
  const { data: geo } = await supabase.rpc("property_geometry", { p_property: propertyId });
  const location = (geo as { location?: { type?: string; coordinates?: [number, number] } } | null)?.location;
  const coords = location?.coordinates;
  if (!coords || coords.length < 2) return;

  const [lng, lat] = coords;
  const [parcel, footprint] = await Promise.all([lookupParcel(lng, lat), lookupFootprint(lng, lat)]);
  if (!parcel && !footprint) return;

  await supabase.rpc("property_set_geometry", {
    p_property: propertyId,
    p_parcel: parcel?.geometry ?? undefined,
    p_parcel_source: parcel?.source ?? undefined,
    p_parcel_apn: parcel?.apn ?? undefined,
    p_footprint: footprint?.geometry ?? undefined,
    p_footprint_source: footprint?.source ?? undefined,
  });
  revalidatePath(`/properties/${propertyId}`);
}

export async function convertLeadAndOpenMeasurement(
  leadId: string,
  accountId?: string | null,
): Promise<ActionResult<ConvertLeadResult>> {
  const session = await requireOrg();
  if (!canEditLeads(session.orgRole)) return fail("You don't have permission to convert leads.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_lead_request", {
    p_lead: leadId,
    p_account: accountId || undefined,
    p_force_fail: false,
  });
  if (error) return fail(error.message);

  const parsed = parseConvertLeadResult(data);
  if (!parsed) return fail("Convert returned an unexpected result.");

  // Best-effort enrich; convert already queued the activity.
  try {
    await queueParcelFootprint(parsed.property_id);
  } catch {
    // Providers optional — measurement still opens.
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath(`/accounts/${parsed.account_id}`);
  revalidatePath("/quotes");

  redirect(parsed.measurement_path);
}
