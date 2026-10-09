"use server";

import { revalidatePath } from "next/cache";
import {
  FEATURE_CATEGORIES,
  FEATURE_SOURCES,
  geometrySchema,
  type FeatureCategory,
  type FeatureSource,
} from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { scoreMeasurementConfidence } from "@/lib/geo/confidence";
import { createClient } from "@/lib/supabase/server";

const featurePayload = z.object({
  category: z.enum(FEATURE_CATEGORIES),
  source: z.enum(FEATURE_SOURCES),
  geometry: geometrySchema.nullable(),
  area_sqft: z.number().nonnegative().nullable(),
  length_ft: z.number().nonnegative().nullable(),
  label: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type SaveFeature = z.infer<typeof featurePayload>;

export async function ensureMeasurement(propertyId: string): Promise<ActionResult<{ id: string }>> {
  await requireOrg();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("measurement_ensure", { p_property: propertyId });
  if (error || !data) return fail(error?.message ?? "Could not open measurement");
  return { ok: true, data: { id: data } };
}

export async function saveMeasurement(
  propertyId: string,
  measurementId: string,
  features: SaveFeature[],
): Promise<ActionResult<{ confidence: number }>> {
  const session = await requireOrg();
  const parsed = z.array(featurePayload).safeParse(features);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid features");

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id, org_id, parcel_source, footprint_source, imagery_date, account_id")
    .eq("id", propertyId)
    .eq("org_id", session.orgId)
    .single();
  if (!property) return fail("Property not found");

  const { data: measurement } = await supabase
    .from("measurements")
    .select("id")
    .eq("id", measurementId)
    .eq("property_id", propertyId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!measurement) return fail("Measurement not found");

  const { error: replaceError } = await supabase.rpc("measurement_replace_features", {
    p_measurement: measurementId,
    p_features: parsed.data,
  });
  if (replaceError) return fail(replaceError.message);

  const confidence = scoreMeasurementConfidence({
    parcelSource: property.parcel_source,
    footprintSource: property.footprint_source,
    imageryDate: property.imagery_date,
    hasManualFallback: parsed.data.some((f) => f.source === "manual"),
  });

  await supabase
    .from("measurements")
    .update({ status: "archived" })
    .eq("property_id", propertyId)
    .eq("status", "current")
    .neq("id", measurementId);

  const { error: updateError } = await supabase
    .from("measurements")
    .update({
      status: "current",
      confidence: confidence.score,
      confidence_reasons: confidence.reasons,
      imagery_date: property.imagery_date,
    })
    .eq("id", measurementId)
    .eq("org_id", session.orgId);
  if (updateError) return fail(updateError.message);

  await supabase.from("activities").insert({
    org_id: session.orgId,
    account_id: property.account_id,
    property_id: propertyId,
    kind: "measurement.saved",
    summary: `Saved measurement (${parsed.data.length} features, ${confidence.band} confidence)`,
    actor_id: session.userId,
  });

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/measure`);
  revalidatePath("/properties");
  return { ok: true, data: { confidence: confidence.score } };
}

export type { FeatureCategory, FeatureSource };
