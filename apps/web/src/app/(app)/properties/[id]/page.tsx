import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { geometrySchema } from "@lawnquoter/shared";
import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { formatMoney } from "@/lib/money";
import { PropertyWorkspace } from "./property-workspace";

export const metadata: Metadata = { title: "Property" };

const OPEN_QUOTES = ["draft", "sent", "viewed", "changed"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseGeom(value: unknown) {
  const parsed = geometrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Pass through null (unknown) and 0 (no gate); do not coerce 0 to unknown. */
const gateWidthIn = (raw: number | null) => raw;
function slopeHint(slope: string | null, raw: unknown) {
  const row = slope ? mergeModifiers(raw).slope?.[slope] : null;
  if (!row?.hoursPct && !row?.pricePct) return slope ? "No price change" : "Set a slope to price it";
  const pct = (n: number, label: string) => `${n > 0 ? "+" : ""}${Math.round(n * 100)}% ${label}`;
  return [row.hoursPct ? pct(row.hoursPct, "hours") : "", row.pricePct ? pct(row.pricePct, "price") : ""].filter(Boolean).join(" · ");
}
export default async function PropertyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await (searchParams ?? Promise.resolve({ tab: undefined }));
  const session = await requireOrg();
  const supabase = await createClient();
  const org = session.orgId;
  const [{ data: property, error: propertyError }, { data: access, error: accessError }, { data: geo, error: geoError }, { data: nearby, error: nearbyError }, quotes, jobs, visits, agreement, activities, measurement, priceLists, zoneRows, openQuotes] = await Promise.all([
    supabase.from("properties").select("*, accounts(id, name, type)").eq("id", id).eq("org_id", session.orgId).maybeSingle(),
    supabase.from("property_access").select("gate_code, access_notes").eq("property_id", id).eq("org_id", session.orgId).maybeSingle(),
    supabase.rpc("property_geometry", { p_property: id }),
    supabase.rpc("properties_near", { p_property: id, p_radius_m: 800 }),
    supabase.from("quotes").select("id, number, title, status").eq("property_id", id).eq("org_id", org).order("created_at", { ascending: false }).limit(8),
    supabase.from("jobs").select("id, title, status").eq("property_id", id).eq("org_id", org).order("created_at", { ascending: false }).limit(8),
    supabase.from("visits").select("id, status, scheduled_date, occurrence_date, routes(crews(name))").eq("property_id", id).eq("org_id", org).order("occurrence_date", { ascending: false }).limit(8),
    supabase.from("agreements").select("frequency, preferred_dow").eq("property_id", id).eq("org_id", org).eq("status", "active").limit(1),
    supabase.from("activities").select("id, summary, occurred_at").eq("property_id", id).eq("org_id", org).order("occurred_at", { ascending: false }).limit(8),
    supabase.from("measurements").select("measurement_features(category, area_sqft)").eq("property_id", id).eq("org_id", org).eq("status", "current").order("updated_at", { ascending: false }).limit(1),
    supabase.from("price_lists").select("modifiers").eq("org_id", org).eq("status", "active").order("version", { ascending: false }).limit(1),
    supabase.from("properties").select("zone").eq("org_id", org).not("zone", "is", null).limit(200),
    supabase.from("quotes").select("current_version, quote_versions(version, quote_line_items(price, selected))").eq("property_id", id).eq("org_id", org).in("status", [...OPEN_QUOTES]),
  ]);
  const loadError = propertyError?.message ?? accessError?.message ?? geoError?.message ?? nearbyError?.message ?? null;
  if (loadError) {
    return (
      <>
        <PageHeader title="Property" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this property</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!property) notFound();
  const g = (geo ?? {}) as Record<string, unknown>;
  const location = parseGeom(g.location);
  const parcel = parseGeom(g.parcel);
  const footprint = parseGeom(g.footprint);
  const features = (measurement.data?.[0]?.measurement_features ?? null) as { category: string; area_sqft: number | null }[] | null;
  const area = (category: string) => features?.filter((feature) => feature.category === category).reduce((sum, feature) => sum + Number(feature.area_sqft ?? 0), 0) ?? null;
  const visitRows = (visits.data ?? []) as { id: string; status: string; scheduled_date: string | null; occurrence_date: string; routes: { crews: { name: string } | null } | null }[];
  const nextVisit = visitRows.find((visit) => visit.status === "scheduled" || visit.status === "in_progress");
  const day = nextVisit?.scheduled_date ? new Date(`${nextVisit.scheduled_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : agreement.data?.[0]?.preferred_dow != null ? DAYS[agreement.data[0].preferred_dow] : null;
  const sqft = (value: number | null) => (value == null ? "—" : `${Math.round(Number(value)).toLocaleString()} sq ft`);
  const front = features ? area("turf_front") : null;
  const back = features ? area("turf_back") : null;
  const pinHint = location == null ? await geocodeAddress(`${property.city}, ${property.region} ${property.postal_code}`) : null;
  const crew = nextVisit?.routes?.crews?.name;
  const openRows = (openQuotes.data ?? []) as { current_version: number; quote_versions: { version: number; quote_line_items: { price: number; selected: boolean }[] | null }[] | null }[];
  const openTotal = openRows.reduce((sum, quote) => sum + (quote.quote_versions?.find((item) => item.version === quote.current_version)?.quote_line_items ?? []).reduce((lineSum, line) => lineSum + (line.selected ? Number(line.price) : 0), 0), 0);
  return (<PropertyWorkspace data={{
    id: property.id, accountId: property.account_id, accountName: property.accounts?.name ?? "Account", street: property.address_line1, place: `${property.city}, ${property.region} ${property.postal_code}`, label: property.name, archived: !property.is_active,
    slope: property.slope, slopeHint: slopeHint(property.slope, priceLists.data?.[0]?.modifiers), gateWidthIn: gateWidthIn(property.gate_width_in), obstacleCount: property.obstacle_count, hasStairs: property.has_stairs, hasDogs: property.has_dogs,
    gateCode: access?.gate_code ?? null, accessNotes: access?.access_notes ?? "", crewNotes: property.crew_notes ?? "", zone: property.zone, zones: [...new Set((zoneRows.data ?? []).map((row) => row.zone).filter((zone): zone is string => Boolean(zone)))].sort(),
    lot: sqft(property.lot_sqft == null ? null : Number(property.lot_sqft)), lotAuto: property.lot_sqft != null && property.parcel_source !== "unknown", building: sqft(property.building_sqft == null ? null : Number(property.building_sqft)), apn: property.parcel_apn, parcelSource: property.parcel_source, footprintSource: property.footprint_source,
    turf: front == null && back == null ? "—" : `${sqft(front)} / ${sqft(back)}`, openQuotes: `${formatMoney(openTotal)} · ${openRows.length} open`, service: crew && day ? `${crew} · ${day}` : day ?? agreement.data?.[0]?.frequency ?? "—", ungeocoded: location == null, pinCenter: pinHint?.location.coordinates ?? null,
    quotes: (quotes.data ?? []).map((quote) => ({ id: quote.id, label: `#${quote.number} ${quote.title}`, status: quote.status })), jobs: (jobs.data ?? []).map((job) => ({ id: job.id, label: job.title, status: job.status })),
    visits: visitRows.map((visit) => ({ id: visit.id, label: visit.scheduled_date ?? visit.occurrence_date, status: visit.status })), activity: (activities.data ?? []).map((item) => ({ id: item.id, summary: item.summary, when: new Date(item.occurred_at).toLocaleDateString() })),
    nearby: ((nearby ?? []) as { id: string; formatted_address: string | null; distance_m: number }[]).slice(0, 8).map((item) => ({ id: item.id, address: item.formatted_address ?? "Nearby property", meters: Math.round(Number(item.distance_m)) })), location, parcel, footprint, tab: tab ?? null,
  }} />);
}
