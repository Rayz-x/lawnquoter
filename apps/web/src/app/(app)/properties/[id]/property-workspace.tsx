"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dog, Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell/page-header";
import { PropertyMap, type PropertyMapProps } from "@/components/map/property-map";
import { ChipGroup, FactStrip, InternalNote, resolveEntryTab, SectionCard, SectionMenu, Stepper, TabBox, ToggleRow, useSectionAutosave } from "@/components/entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { regeocodeProperty } from "../../accounts/actions";
import { createQuoteAndGo } from "../../quotes/actions";
import { archiveProperty, placePropertyPin, updatePropertyAccess, updatePropertyAddress, updatePropertyConditions, updatePropertyMeta } from "./actions";

type Slope = "flat" | "gentle" | "moderate" | "steep" | null;
type Row = { id: string; label: string; status: string };
type Conditions = { slope: Slope; gate_width_in: number | null; obstacle_count: number; has_stairs: boolean };
type Access = { has_dogs: boolean; gate_code: string | null; access_notes: string | null; crew_notes: string | null };

export type PropertyScreenData = {
  id: string; accountId: string; accountName: string; street: string; place: string; label: string | null; archived: boolean; slope: Slope; slopeHint: string; gateWidthIn: number | null; obstacleCount: number; hasStairs: boolean; hasDogs: boolean; gateCode: string | null; accessNotes: string; crewNotes: string; zone: string | null; zones: string[]; lot: string; lotAuto: boolean; building: string; apn: string | null; parcelSource: string; footprintSource: string; turf: string; openQuotes: string; service: string; ungeocoded: boolean; pinCenter: [number, number] | null; quotes: Row[]; jobs: Row[]; visits: Row[]; activity: { id: string; summary: string; when: string }[]; nearby: { id: string; address: string; meters: number }[]; location: PropertyMapProps["location"]; parcel: PropertyMapProps["parcel"]; footprint: PropertyMapProps["footprint"]; tab: string | null;
};

const TABS = ["quotes", "visits", "activity"] as const;
const SLOPE_CHIPS = [{ value: "flat", label: "Flat" }, { value: "gentle", label: "Gentle" }, { value: "moderate", label: "Moderate" }, { value: "steep", label: "Steep" }] as const;
const GATE_CHIPS = [{ value: "under", label: "Under 48 in" }, { value: "wide", label: "48 in+" }] as const;
const titled = (value: string | null) => (value ? value[0]!.toUpperCase() + value.slice(1) : "Unknown");

export function PropertyWorkspace({ data }: { data: PropertyScreenData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState(() => resolveEntryTab(data.tab, TABS, "quotes"));
  const [renaming, setRenaming] = useState(false); const [label, setLabel] = useState(data.label ?? "");
  const [exactOpen, setExactOpen] = useState(data.gateWidthIn != null && data.gateWidthIn !== 36 && data.gateWidthIn !== 48);
  const [addressOpen, setAddressOpen] = useState(false); const [pinning, setPinning] = useState(false); const [address, setAddress] = useState(`${data.street}, ${data.place}`);
  const gateWidthRef = useRef<HTMLInputElement>(null);
  const [gateInches, setGateInches] = useState(() => (data.gateWidthIn == null ? "" : String(data.gateWidthIn)));
  const [revealGate, setRevealGate] = useState(false);
  const [cond, setCond] = useState<Conditions>({ slope: data.slope, gate_width_in: data.gateWidthIn, obstacle_count: data.obstacleCount, has_stairs: data.hasStairs });
  const [access, setAccess] = useState<Access>({ has_dogs: data.hasDogs, gate_code: data.gateCode, access_notes: data.accessNotes || null, crew_notes: data.crewNotes || null });
  const [zone, setZone] = useState(data.zone ?? "");
  const [savedCond] = useState(cond); const [savedAccess] = useState(access); const [savedZone] = useState(zone);
  const conditions = useSectionAutosave({ action: (values: Conditions) => updatePropertyConditions(data.id, values), initial: savedCond, onRollback: setCond });
  const accessSave = useSectionAutosave({ action: (values: Access) => updatePropertyAccess(data.id, values), initial: savedAccess, onRollback: setAccess });
  const zoneSave = useSectionAutosave({ action: (value: string) => updatePropertyMeta(data.id, { zone: value || null }), initial: savedZone, onRollback: setZone });
  const knownWidth = cond.gate_width_in != null && cond.gate_width_in > 0 ? cond.gate_width_in : null;
  const narrow = knownWidth != null && knownWidth < 48;
  const gateChip = knownWidth == null ? "" : knownWidth < 48 ? "under" : "wide";
  const saveCond = (patch: Partial<Conditions>) => { setCond((current) => ({ ...current, ...patch })); conditions.save(patch, { immediate: true, rollback: true }); };
  const saveAccess = (patch: Partial<Access>, choice = false) => { setAccess((current) => ({ ...current, ...patch })); accessSave.save(patch, choice ? { immediate: true, rollback: true } : undefined); };
  const newQuote = () => startTransition(async () => { const result = await createQuoteAndGo(data.accountId, data.id); if (!result.ok) toast.error(result.error); });
  const saveAddress = () => { const match = address.trim().match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/); if (!match) { toast.error("Enter the address as Street, City, ST ZIP."); return; } startTransition(async () => { const saved = await updatePropertyAddress(data.id, { address_line1: match[1]!.trim(), city: match[2]!.trim(), region: match[3]!.toUpperCase(), postal_code: match[4]! }); if (!saved.ok) { toast.error(saved.error); return; } const geo = await regeocodeProperty(data.id); if (!geo.ok) { toast.error(geo.error); return; } geo.data.warnings.forEach((warning) => toast.warning(warning)); setAddressOpen(false); setPinning(false); router.refresh(); }); };
  const placePin = (coordinates: [number, number]) => startTransition(async () => { const result = await placePropertyPin(data.id, coordinates); if (!result.ok) { toast.error(result.error); return; } setPinning(false); router.refresh(); });
  const startPin = () => { if (data.pinCenter) return setPinning(true); setAddressOpen(true); toast("Edit the address before dropping a pin."); };
  const openGateWidth = () => { setExactOpen(true); setTimeout(() => gateWidthRef.current?.focus(), 0); };
  const commitGateInches = () => { const raw = gateInches.trim(); const width = raw === "" || Number(raw) <= 0 ? null : /^\d+$/.test(raw) && Number(raw) >= 12 && Number(raw) <= 240 ? Number(raw) : Number.NaN; if (Number.isNaN(width)) return setGateInches(knownWidth == null ? "" : String(knownWidth)); setGateInches(width == null ? "" : String(width)); setCond((current) => ({ ...current, gate_width_in: width })); conditions.save({ gate_width_in: width }, { immediate: true, rollback: true }); };
  const commitGate = (value: string) => saveAccess({ gate_code: value.trim() || null });
  const onGateChip = (next: string) => {
    if (!next) { setGateInches(""); return saveCond({ gate_width_in: null }); }
    if (next === "under") { if (knownWidth != null && knownWidth < 48) return; setGateInches("36"); return saveCond({ gate_width_in: 36 }); }
    if (knownWidth != null && knownWidth >= 48) return;
    setGateInches("48"); saveCond({ gate_width_in: 48 });
  };

  return (
    <>
    <PageHeader title={data.street} />
    <div className="page-pad flex flex-col gap-4 pb-28 lg:pb-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground"><Link href="/accounts" className="hover:underline">Accounts</Link>{" › "}<Link href={`/accounts/${data.accountId}`} className="hover:underline">{data.accountName}</Link>{" › "}<span>{data.street}</span></p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{data.street}</h1>
            <p className="text-sm text-muted-foreground">{data.place}{label ? ` · ${label}` : ""}</p>
            {renaming ? <Input autoFocus aria-label="Property label" value={label} className="mt-2 max-w-xs" onChange={(event) => setLabel(event.target.value)} onBlur={() => { setRenaming(false); const next = label.trim(); if (next !== (data.label ?? "")) void updatePropertyMeta(data.id, { name: next || null }).then((result) => { if (!result.ok) toast.error(result.error); }); }} onKeyDown={(event) => { if (event.key === "Escape") { setLabel(data.label ?? ""); setRenaming(false); } if (event.key === "Enter") event.currentTarget.blur(); }} /> : null}
          </div>
          <div className="flex items-center gap-2">
            {access.has_dogs ? <Badge className="border-transparent bg-warning/15 text-warning"><Dog data-icon="inline-start" />Dog on site</Badge> : null}
            {data.archived ? <Badge variant="outline">Archived</Badge> : null}
            <Button className="hidden lg:inline-flex" disabled={pending} onClick={newQuote}>New quote</Button>
            <Button className="hidden lg:inline-flex" variant="outline" render={<Link href={`/properties/${data.id}/measure`} />}>Measure</Button>
            <SectionMenu label="Property actions" items={[{ id: "rename", label: "Rename", onSelect: () => setRenaming(true) }, { id: "archive", label: "Archive", destructive: true, confirm: "It stays on the account and drops out of active lists.", onSelect: () => startTransition(async () => { const result = await archiveProperty(data.id); if (!result.ok) toast.error(result.error); }) }]} />
          </div>
        </div>
        {data.ungeocoded ? (addressOpen ? (
          <div className="flex max-w-xl flex-col gap-2">
            <Input aria-label="Street address" value={address} placeholder="123 Main St, Springfield, IL 62704" onChange={(event) => setAddress(event.target.value)} />
            <div className="flex gap-2"><Button type="button" disabled={pending} onClick={saveAddress}>Save address</Button><Button type="button" variant="outline" onClick={() => setAddressOpen(false)}>Cancel</Button></div>
          </div>
        ) : <Button type="button" variant="outline" className="self-start" onClick={() => setAddressOpen(true)}>Fix address</Button>) : null}
      </header>

      <FactStrip facts={[{ label: "Turf", value: data.turf }, { label: "Lot", value: data.lot, hint: data.lotAuto ? "From parcel" : undefined }, { label: "Gate", value: knownWidth == null ? <button type="button" className="underline-offset-4 hover:underline" onClick={openGateWidth}>Add gate width</button> : <span className={narrow ? "text-warning" : undefined}>{`${knownWidth} in`}</span>, detail: knownWidth == null ? undefined : narrow ? `${knownWidth} in · push mower only` : "Fits a rider" }, { label: "Slope", value: titled(cond.slope), detail: data.slopeHint }, { label: "Open quotes", value: data.openQuotes }, { label: "Service", value: data.service }]} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Site map" description={`Parcel (${data.parcelSource}) · footprint (${data.footprintSource})`} menu={<SectionMenu label="Map actions" items={[{ id: "measure", label: "Re-measure", onSelect: () => router.push(`/properties/${data.id}/measure`) }, { id: "geocode", label: "Re-geocode", onSelect: () => startTransition(async () => { const result = await regeocodeProperty(data.id); if (result.ok) { result.data.warnings.forEach((warning) => toast.warning(warning)); router.refresh(); } else toast.error(result.error); }) }]} />}>
            {data.ungeocoded && !(pinning && data.pinCenter) ? (
              <div className="flex h-64 w-full flex-col items-center justify-center gap-3 rounded-lg bg-muted px-4 text-center lg:h-80"><p className="text-sm font-medium">We couldn&apos;t place this address</p><div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={() => setAddressOpen(true)}>Edit address</Button><Button type="button" variant="outline" onClick={startPin}>Drop a pin</Button></div></div>
            ) : (
              <PropertyMap location={data.ungeocoded ? null : data.location} parcel={data.ungeocoded ? null : data.parcel} footprint={data.ungeocoded ? null : data.footprint} fallbackCenter={data.pinCenter} hideNavigation={data.ungeocoded} onPick={data.ungeocoded ? placePin : undefined} className="h-64 w-full overflow-hidden rounded-lg lg:h-80" />
            )}
          </SectionCard>
          <SectionCard title="Mowing conditions" description={`These change the price. ${data.slopeHint}`} status={conditions.status} error={conditions.error} onRetry={conditions.retry}>
            <ChipGroup label="Slope" options={SLOPE_CHIPS} value={cond.slope ?? ""} onValueChange={(value) => saveCond({ slope: value ? value as Exclude<Slope, null> : null })} />
            <ChipGroup label="Narrowest gate" options={GATE_CHIPS} value={gateChip} onValueChange={onGateChip} />
            <button type="button" className="self-start text-sm underline-offset-4 hover:underline" onClick={() => setExactOpen((open) => !open)}>{exactOpen ? "Hide exact inches" : "Exact inches"}</button>
            {exactOpen ? <Input ref={gateWidthRef} className="max-w-32" inputMode="numeric" aria-label="Gate width in inches" value={gateInches} onChange={(event) => { const raw = event.target.value; if (raw === "" || /^\d+$/.test(raw)) setGateInches(raw); }} onBlur={commitGateInches} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitGateInches(); } }} /> : null}
            <Stepper label="Obstacles" min={0} max={50} value={cond.obstacle_count} onValueChange={(count) => saveCond({ obstacle_count: count })} />
            <ToggleRow label="Stairs to the turf" checked={cond.has_stairs} onCheckedChange={(checked) => saveCond({ has_stairs: checked })} />
          </SectionCard>
          <TabBox label="Property categories" value={tab} onValueChange={(next) => { setTab(next); router.replace(`?tab=${next}`, { scroll: false }); }} tabs={[
            { value: "quotes", label: "Quotes & jobs", count: data.quotes.length + data.jobs.length, content: <div className="flex flex-col gap-2"><Rows rows={data.quotes} href={(id) => `/quotes/${id}`} empty="No quotes yet." /><Rows rows={data.jobs} empty="No jobs yet." /></div> },
            { value: "visits", label: "Visits", count: data.visits.length, content: <Rows rows={data.visits} empty="No visits yet." /> },
            { value: "activity", label: "Activity", count: data.activity.length, content: data.activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : <div className="flex flex-col gap-2">{data.activity.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.summary}</span><span className="text-xs text-muted-foreground">{item.when}</span></div>)}</div> },
          ]} />
        </div>
        <aside className="flex flex-col gap-4">
          <SectionCard title="Access & crew" description="Dog warning, gate code, and notes." tone={access.has_dogs ? "warning" : undefined} status={accessSave.status} error={accessSave.error} onRetry={accessSave.retry}>
            <ToggleRow label={<span className="inline-flex items-center gap-2"><Dog className="size-4" />Dogs on site</span>} checked={access.has_dogs} onCheckedChange={(checked) => saveAccess({ has_dogs: checked }, true)} />
            <label className="flex flex-col gap-1 text-sm"><span className="inline-flex items-center gap-2"><Lock className="size-4" />Gate code</span><span className="flex items-center gap-2"><Input className="min-w-0 flex-1" type={revealGate ? "text" : "password"} inputMode="numeric" aria-label="Gate code" autoComplete="off" spellCheck={false} placeholder="Crews see it on visit day only" value={access.gate_code ?? ""} onChange={(event) => setAccess((current) => ({ ...current, gate_code: event.target.value }))} onBlur={(event) => commitGate(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitGate(event.currentTarget.value); } }} /><Button type="button" variant="outline" size="icon" aria-pressed={revealGate} aria-label={revealGate ? "Hide gate code" : "Show gate code"} onClick={() => setRevealGate((open) => !open)}>{revealGate ? <EyeOff /> : <Eye />}</Button></span></label>
            <label className="flex flex-col gap-1 text-sm"><span className="inline-flex items-center gap-2"><Eye aria-hidden="true" className="size-4" />Access notes for customer</span><Textarea aria-label="Access notes for customer" value={access.access_notes ?? ""} rows={2} onChange={(event) => saveAccess({ access_notes: event.target.value })} onBlur={(event) => saveAccess({ access_notes: event.target.value.trim() || null })} /></label>
            <InternalNote label="Crew notes"><Textarea className="field-sizing-fixed min-h-24 w-full" rows={3} value={access.crew_notes ?? ""} onChange={(event) => saveAccess({ crew_notes: event.target.value })} onBlur={(event) => saveAccess({ crew_notes: event.target.value.trim() || null })} /></InternalNote>
          </SectionCard>
          <SectionCard title="Parcel & records" description="Filled from the parcel and footprint." status={zoneSave.status} error={zoneSave.error} onRetry={zoneSave.retry}>
            <p className="text-sm">Lot <span className="text-muted-foreground">{data.lot}{data.lotAuto ? " ✦" : ""}</span></p>
            <p className="text-sm">Building <span className="text-muted-foreground">{data.building} ✦</span></p>
            <p className="text-sm">APN <span className="text-muted-foreground">{data.apn ?? "—"} ✦</span></p>
            <label className="flex flex-col gap-1 text-sm">Route zone<Input list="property-zones" aria-label="Route zone" value={zone} onChange={(event) => { setZone(event.target.value); zoneSave.save(event.target.value); }} onBlur={(event) => { const next = event.target.value.trim(); setZone(next); zoneSave.save(next); }} /><datalist id="property-zones">{data.zones.map((item) => <option key={item} value={item} />)}</datalist></label>
          </SectionCard>
          <SectionCard title="Nearby" description="Within 800 m.">
            {data.nearby.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : data.nearby.map((item) => <Link key={item.id} href={`/properties/${item.id}`} className="flex justify-between gap-2 text-sm hover:underline"><span className="truncate">{item.address}</span><span className="text-muted-foreground">{item.meters} m</span></Link>)}
          </SectionCard>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"><Button className="h-11 flex-1" variant="outline" render={<Link href={`/properties/${data.id}/measure`} />}>Measure</Button><Button className="h-11 flex-1" disabled={pending} onClick={newQuote}>New quote</Button></div>
    </div>
    </>
  );
}

function Rows({ rows, href, empty }: { rows: Row[]; href?: (id: string) => string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <div className="flex flex-col gap-2">{rows.map((row) => { const body = <span className="flex justify-between gap-2"><span className="truncate">{row.label}</span><span className="capitalize text-muted-foreground">{row.status}</span></span>; return href ? <Link key={row.id} href={href(row.id)} className="text-sm hover:underline">{body}</Link> : <div key={row.id} className="text-sm">{body}</div>; })}</div>;
}
