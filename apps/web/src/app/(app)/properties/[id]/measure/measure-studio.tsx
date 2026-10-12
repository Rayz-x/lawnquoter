"use client";

import { useMemo, useState, useTransition } from "react";
import { HelpTip } from "@/components/help/help-tip";
import { useRouter } from "next/navigation";
import difference from "@turf/difference";
import { feature, featureCollection } from "@turf/helpers";
import {
  FEATURE_CATEGORIES,
  FEATURE_COLORS,
  FEATURE_LABELS,
  isLineCategory,
  type FeatureCategory,
  type Geometry,
} from "@lawnquoter/shared";
import { toast } from "sonner";
import { Eraser, MousePointer2, Pentagon, Pencil, Minus, Save, Sparkles, Trash2 } from "lucide-react";
import { IMAGERY_CHOICES, imageryChoiceForDate } from "@/components/map/imagery-dates";
import { MeasureMap, type DrawMode } from "@/components/map/measure-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { scoreMeasurementConfidence } from "@/lib/geo/confidence";
import type { ImageryIntegrationStatus } from "@/lib/geo/imagery-integrations";
import { liveSize, newFeature, summarize, type StudioFeature } from "@/lib/geo/features";
import { prefillTurf } from "@/lib/geo/prefill";
import { parseTakeoff } from "@/lib/geo/takeoff";
import { saveMeasurement } from "./actions";

export function MeasureStudio({
  propertyId,
  measurementId,
  initialFeatures,
  parcel,
  footprint,
  location,
  parcelSource,
  footprintSource,
  imageryDate,
  integrations,
}: {
  propertyId: string;
  measurementId: string;
  initialFeatures: StudioFeature[];
  parcel: Geometry | null;
  footprint: Geometry | null;
  location: Geometry | null;
  parcelSource: string | null;
  footprintSource: string | null;
  imageryDate: string | null;
  integrations: ImageryIntegrationStatus;
}) {
  const router = useRouter();
  const [features, setFeatures] = useState<StudioFeature[]>(initialFeatures);
  const [imagery, setImagery] = useState(() => imageryChoiceForDate(imageryDate));
  const [imageryTouched, setImageryTouched] = useState(false);
  const [mode, setMode] = useState<DrawMode>("select");
  const [category, setCategory] = useState<FeatureCategory>("turf_front");
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => summarize(features), [features]);
  const confidence = useMemo(
    () =>
      scoreMeasurementConfidence({
        parcelSource,
        footprintSource,
        imageryDate: imagery.date,
        hasManualFallback: features.some((feature) => feature.source === "manual"),
      }),
    [parcelSource, footprintSource, imagery.date, features],
  );
  const band = confidence.band;

  const onDrawn = (geometry: Geometry) => {
    if (mode === "cut") {
      setFeatures((prev) => {
        const target = [...prev].reverse().find((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"));
        if (!target?.geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
          toast.error("Draw a cut over an existing area feature");
          return prev;
        }
        const a = feature(target.geometry as Extract<Geometry, { type: "Polygon" | "MultiPolygon" }>);
        const b = feature(geometry as Extract<Geometry, { type: "Polygon" | "MultiPolygon" }>);
        const cut = difference(featureCollection([a, b]) as Parameters<typeof difference>[0]);
        if (!cut?.geometry) {
          toast.error("Cut removed the whole feature");
          return prev.filter((f) => f.clientId !== target.clientId);
        }
        return prev.map((f) => (f.clientId === target.clientId ? { ...f, geometry: cut.geometry as Geometry, source: "traced" as const } : f));
      });
      return;
    }
    const cat = isLineCategory(category) && geometry.type !== "LineString" ? "turf_front" : category;
    const draft = newFeature({ category: cat, source: "traced", geometry, area_sqft: null, length_ft: null });
    const size = liveSize(draft);
    setFeatures((prev) => [...prev, { ...draft, ...size }]);
  };

  const prefill = () => {
    const auto = prefillTurf({ parcel, footprint, location });
    if (auto.length === 0) {
      toast.error("Need a parcel first. Refresh the property geometry, or trace by hand.");
      return;
    }
    setFeatures((prev) => {
      const kept = prev.filter((f) => f.source !== "auto" || (f.category !== "turf_front" && f.category !== "turf_back"));
      return [
        ...kept,
        ...auto.map((a) => {
          const f = newFeature({ category: a.category, source: "auto", geometry: a.geometry, area_sqft: null, length_ft: null });
          return { ...f, ...liveSize(f) };
        }),
      ];
    });
    toast.success("Prefill applied — edit the edges before sending a quote");
  };

  const addManual = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const cat = fd.get("category") as FeatureCategory;
    const raw = Number(fd.get("size"));
    if (!FEATURE_CATEGORIES.includes(cat) || !Number.isFinite(raw) || raw <= 0) {
      toast.error("Enter a size greater than zero");
      return;
    }
    const line = isLineCategory(cat);
    setFeatures((prev) => [
      ...prev,
      newFeature({
        category: cat,
        source: "manual",
        geometry: null,
        area_sqft: line ? null : raw,
        length_ft: line ? raw : null,
      }),
    ]);
    e.currentTarget.reset();
  };

  const save = () =>
    startTransition(async () => {
      const r = await saveMeasurement(
        propertyId,
        measurementId,
        features.map((f) => ({
          category: f.category,
          source: f.source,
          geometry: f.geometry,
          area_sqft: liveSize(f).area_sqft,
          length_ft: liveSize(f).length_ft,
          label: f.label ?? null,
          notes: f.notes ?? null,
          })),
        imageryTouched ? imagery.date : undefined,
      );
      if (r.ok) {
        toast.success(`Measurement saved · ${Math.round(r.data.confidence * 100)}% confidence`);
        router.push(`/properties/${propertyId}`);
      } else toast.error(r.error);
    });

  return (
    <div className="page-pad grid gap-4 lg:grid-cols-[minmax(0,1fr)_min(20rem,100%)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 [justify-content:safe_start]">
          <Tool mode={mode} setMode={setMode} id="select" icon={<MousePointer2 data-icon="inline-start" />} label="Select" />
          <Tool mode={mode} setMode={setMode} id="polygon" icon={<Pentagon data-icon="inline-start" />} label="Polygon" />
          <Tool mode={mode} setMode={setMode} id="freehand" icon={<Pencil data-icon="inline-start" />} label="Freehand" />
          <Tool mode={mode} setMode={setMode} id="linestring" icon={<Minus data-icon="inline-start" />} label="Line" />
          <Tool mode={mode} setMode={setMode} id="cut" icon={<Eraser data-icon="inline-start" />} label="Cut" />
          <label className="inline-flex">
            <input
              className="sr-only"
              type="file"
              accept=".json,.geojson,.csv,application/json,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => {
                  const result = parseTakeoff(text);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  setFeatures((prev) => [
                    ...prev,
                    ...result.features.map((item) => {
                      const draft = newFeature(item);
                      return { ...draft, ...liveSize(draft) };
                    }),
                  ]);
                  toast.success(`Imported ${result.features.length} takeoff ${result.features.length === 1 ? "feature" : "features"}`);
                });
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md border bg-background px-3 text-sm">Import takeoff</span>
          </label>
          <Button variant="outline" size="sm" onClick={prefill}>
            <Sparkles data-icon="inline-start" />
            Auto-prefill turf
          </Button>
          <div className="ml-auto">
            <Button onClick={save} disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              Save measurement
            </Button>
          </div>
        </div>
        <MeasureMap
          key={imagery.id}
          location={location}
          parcel={parcel}
          footprint={footprint}
          features={features}
          mode={mode}
          imageryRelease={imagery.release}
          onDrawn={onDrawn}
          className="h-[min(70vh,40rem)] w-full overflow-hidden rounded-lg"
        />
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="imagery-date" className="flex flex-col gap-1">
            Imagery date
            <select
              id="imagery-date"
             
              className="native-control w-full"
              value={imagery.id}
              onChange={(event) => {
                const next = IMAGERY_CHOICES.find((choice) => choice.id === event.target.value);
                if (!next) return;
                setImageryTouched(true);
                setImagery(next);
              }}
            >
              {IMAGERY_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>
          </div>
          <p>Esri World Imagery (tracing permitted). Yellow dashed = parcel. Red = building. An older photo helps when the latest view is trees or construction. Import takeoff reads GeoJSON, or a CSV saved from Excel with columns category and area_sqft.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1">
              HD imagery and segmentation
              <HelpTip
                label="Help for imagery"
                text="Nearmap, Vexcel, and segmentation stay off until that key is saved. A saved key does not call them on its own."
                href="/help/integrations#imagery"
              />
            </CardTitle>
            <CardDescription>These stay off. Tracing on Esri does not need them.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{integrations.nearmap.message}</p>
            <p>{integrations.vexcel.message}</p>
            <p>{integrations.segmentation.message}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Confidence
              <Badge variant={band === "high" ? "default" : band === "medium" ? "secondary" : "outline"}>
                {band} · {Math.round(confidence.score * 100)}%
              </Badge>
            </CardTitle>
            <CardDescription>
              {band === "low"
                ? "Quotes from this measurement should go out as a range with site verification pending."
                : band === "medium"
                  ? "Usable for a quote range. Confirm edges on high-value jobs."
                  : "High enough for a point price. Still let the customer know we confirm on the first visit."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
            {confidence.reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category</CardTitle>
            <CardDescription>Applies to the next shape you draw.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {FEATURE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCategory(c);
                  setMode(isLineCategory(c) ? "linestring" : mode === "linestring" ? "polygon" : mode);
                }}
                className="rounded-md border px-2 py-1 text-xs"
                style={{
                  borderColor: category === c ? FEATURE_COLORS[c] : undefined,
                  background: category === c ? `${FEATURE_COLORS[c]}22` : undefined,
                }}
              >
                {FEATURE_LABELS[c]}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Features</CardTitle>
            <CardDescription>
              Turf {totals.turf ? `${Math.round(totals.turf).toLocaleString()} sq ft` : "not traced"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {features.map((f) => {
              const size = liveSize(f);
              return (
                <div key={f.clientId} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="inline-block size-2.5 rounded-sm" style={{ background: FEATURE_COLORS[f.category] }} />
                      {FEATURE_LABELS[f.category]}
                      <Badge variant="outline" className="capitalize">
                        {f.source}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {size.area_sqft != null
                        ? `${Math.round(size.area_sqft).toLocaleString()} sq ft`
                        : size.length_ft != null
                          ? `${Math.round(size.length_ft).toLocaleString()} ft`
                          : "no size"}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setFeatures((prev) => prev.filter((x) => x.clientId !== f.clientId))}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            {features.length === 0 ? <p className="text-sm text-muted-foreground">Nothing measured yet.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enter size by hand</CardTitle>
            <CardDescription>Always available when imagery or the parcel is wrong.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addManual} className="flex flex-col gap-3">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="manual_cat">Category</FieldLabel>
                  <select id="manual_cat" name="category" className="native-control w-full" defaultValue="turf_front">
                    {FEATURE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {FEATURE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="manual_size">Square feet or linear feet</FieldLabel>
                  <Input id="manual_size" name="size" type="number" min={1} step={1} required className="w-full" />
                </Field>
              </FieldGroup>
              <Button type="submit" variant="outline">
                Add manual size
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tool({
  mode,
  setMode,
  id,
  icon,
  label,
}: {
  mode: DrawMode;
  setMode: (m: DrawMode) => void;
  id: DrawMode;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button variant={mode === id ? "default" : "outline"} size="sm" onClick={() => setMode(id)}>
      {icon}
      {label}
    </Button>
  );
}
