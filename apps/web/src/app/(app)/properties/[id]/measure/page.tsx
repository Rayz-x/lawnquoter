import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FEATURE_CATEGORIES, FEATURE_SOURCES, geometrySchema, type FeatureCategory, type FeatureSource } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/session";
import { scoreMeasurementConfidence } from "@/lib/geo/confidence";
import type { StudioFeature } from "@/lib/geo/features";
import { createClient } from "@/lib/supabase/server";
import { MeasureStudio } from "./measure-studio";

export const metadata: Metadata = { title: "Measure" };

function parseGeom(value: unknown) {
  const parsed = geometrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export default async function MeasurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, formatted_address, address_line1, parcel_source, footprint_source, imagery_date")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .single();
  if (!property) notFound();

  const [{ data: measurementId }, { data: geo }] = await Promise.all([
    supabase.rpc("measurement_ensure", { p_property: id }),
    supabase.rpc("property_geometry", { p_property: id }),
  ]);
  if (!measurementId) notFound();

  const { data: rawFeatures } = await supabase.rpc("measurement_features_geojson", { p_measurement: measurementId });
  const features: StudioFeature[] = [];
  if (Array.isArray(rawFeatures)) {
    for (const row of rawFeatures as Array<Record<string, unknown>>) {
      const category = FEATURE_CATEGORIES.find((c) => c === row.category);
      const source = FEATURE_SOURCES.find((s) => s === row.source);
      if (!category || !source) continue;
      features.push({
        clientId: String(row.id ?? crypto.randomUUID()),
        category: category as FeatureCategory,
        source: source as FeatureSource,
        geometry: parseGeom(row.geometry),
        area_sqft: row.area_sqft == null ? null : Number(row.area_sqft),
        length_ft: row.length_ft == null ? null : Number(row.length_ft),
        label: typeof row.label === "string" ? row.label : null,
        notes: typeof row.notes === "string" ? row.notes : null,
      });
    }
  }

  const g = (geo ?? {}) as Record<string, unknown>;
  const confidence = scoreMeasurementConfidence({
    parcelSource: property.parcel_source,
    footprintSource: property.footprint_source,
    imageryDate: property.imagery_date,
    hasManualFallback: features.some((f) => f.source === "manual"),
  });

  return (
    <>
      <PageHeader
        title={`Measure · ${property.name ?? property.formatted_address ?? property.address_line1}`}
        description="Trace turf, beds, and lines on Esri imagery. Prefill from the parcel, then edit."
        actions={
          <Button variant="outline" render={<Link href={`/properties/${property.id}`} />}>
            Back to property
          </Button>
        }
      />
      <MeasureStudio
        propertyId={property.id}
        measurementId={measurementId}
        initialFeatures={features}
        parcel={parseGeom(g.parcel)}
        footprint={parseGeom(g.footprint)}
        location={parseGeom(g.location)}
        confidence={confidence}
      />
    </>
  );
}
