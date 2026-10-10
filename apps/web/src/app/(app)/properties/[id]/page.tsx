import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ruler } from "lucide-react";
import { geometrySchema } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { PropertyMap } from "@/components/map/property-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PropertyForm } from "../../accounts/[id]/property-form";
import { RegeocodeButton } from "./regeocode-button";

export const metadata: Metadata = { title: "Property" };

function parseGeom(value: unknown) {
  const parsed = geometrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();
  const [{ data: property }, { data: access }, { data: geo }, { data: nearby }] = await Promise.all([
    supabase.from("properties").select("*, accounts(id, name, type)").eq("id", id).eq("org_id", session.orgId).single(),
    supabase.from("property_access").select("gate_code, access_notes").eq("property_id", id).eq("org_id", session.orgId).maybeSingle(),
    supabase.rpc("property_geometry", { p_property: id }),
    supabase.rpc("properties_near", { p_property: id, p_radius_m: 800 }),
  ]);
  if (!property) notFound();

  const g = (geo ?? {}) as Record<string, unknown>;
  const location = parseGeom(g.location);
  const parcel = parseGeom(g.parcel);
  const footprint = parseGeom(g.footprint);

  return (
    <>
      <PageHeader
        title={property.name ?? property.formatted_address ?? property.address_line1}
        description={
          property.accounts ? (
            `${property.accounts.name}`
          ) : undefined
        }
        actions={
          <>
            <RegeocodeButton propertyId={property.id} />
            <Button render={<Link href={`/properties/${property.id}/measure`} />}>
              <Ruler data-icon="inline-start" />
              Measure
            </Button>
          </>
        }
      />
      <div className="page-pad grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Site map</CardTitle>
            <CardDescription>
              Yellow: parcel ({property.parcel_source}). Red: building footprint ({property.footprint_source}). Imagery: Esri World Imagery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PropertyMap location={location} parcel={parcel} footprint={footprint} className="h-[28rem] w-full overflow-hidden rounded-lg" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">Lot {property.lot_sqft ? `${Math.round(Number(property.lot_sqft)).toLocaleString()} sq ft` : "unknown"}</Badge>
              <Badge variant="outline">
                Building {property.building_sqft ? `${Math.round(Number(property.building_sqft)).toLocaleString()} sq ft` : "unknown"}
              </Badge>
              {property.parcel_apn ? <Badge variant="outline">APN {property.parcel_apn}</Badge> : null}
              {property.gate_width_in ? <Badge variant="outline">Gate {property.gate_width_in} in</Badge> : null}
              {property.slope ? <Badge variant="outline" className="capitalize">Slope: {property.slope}</Badge> : null}
              {property.has_dogs ? <Badge variant="outline">Dogs</Badge> : null}
              {property.has_stairs ? <Badge variant="outline">Stairs</Badge> : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Nearby properties</CardTitle>
              <CardDescription>Within 800 m. Route density and neighborhood price memory.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {(nearby ?? []).slice(0, 8).map((n) => (
                <Link key={n.id} href={`/properties/${n.id}`} className="flex justify-between gap-2 hover:underline">
                  <span className="truncate">{n.formatted_address}</span>
                  <span className="shrink-0 text-muted-foreground">{Math.round(Number(n.distance_m))} m</span>
                </Link>
              ))}
              {(nearby ?? []).length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="max-w-2xl">
            <CardContent className="pt-6">
              <PropertyForm accountId={property.account_id} property={property} access={access} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
