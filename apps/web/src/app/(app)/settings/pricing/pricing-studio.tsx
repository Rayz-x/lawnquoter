"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pricingRuleSchema, type Modifiers, type TierMatrixRule, type TierRow } from "@lawnquoter/pricing-engine";
import { Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionMenu, TabBox, useSectionAutosave, type SectionAutosaveStatus } from "@/components/entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMoney } from "@/lib/money";
import { deleteRule, saveRule, toggleService, updateService } from "./actions";
import { allowClick, tierSaveOptions } from "./pricing-entry";
import { MaterialsPanel } from "./materials-panel";
import { ModifiersForm } from "./modifiers-form";
import { RuleForm, STARTER } from "./rule-form";
import { ServiceForm } from "./service-form";

export type StudioService = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  active: boolean;
  openQuotes: number;
  windowStart: string | null;
  windowEnd: string | null;
  warnDate: string | null;
};
export type StudioRule = { id: string; serviceId: string; name: string; config: unknown };
type Material = { id: string; sku: string | null; name: string; unit: string; unit_cost: number; vendor: string | null };
type RuleSave = { id: string; serviceId: string; name: string; config: TierMatrixRule };

const KINDS = [["mowing", "Mowing"], ["fert", "Fert & weed"], ["cleanup", "Cleanup"], ["snow", "Snow"], ["irrigation", "Irrigation"], ["install", "Install"], ["other", "Other"]] as const;
const QTY = [{ key: "turf_sqft", label: "Turf sq ft", unit: "sq ft" }, { key: "lot_sqft", label: "Lot sq ft", unit: "sq ft" }, { key: "edging_lf", label: "Linear ft", unit: "ft" }, { key: "each", label: "Each", unit: "each" }] as const;
const MODS = [["slope", "Slope"], ["narrowGate", "Gate"], ["perObstacle", "Obstacles"], ["stairs", "Stairs"], ["firstCut", "First cut"]] as const;

const kindLabel = (kind: string) => KINDS.find((item) => item[0] === kind)?.[1] ?? kind;
const asTier = (config: unknown) => { const parsed = pricingRuleSchema.safeParse(config); return parsed.success && parsed.data.type === "tier_matrix" ? parsed.data : null; };
const span = (config: unknown) => { const tier = asTier(config); if (!tier) return "Custom"; const prices = tier.rows.map((row) => row.price); const low = Math.min(...prices), high = Math.max(...prices); return low === high ? formatMoney(low) : `${formatMoney(low)}–${formatMoney(high)}`; };
const qtyOf = (key: string) => QTY.find((item) => item.key === key) ?? { key, label: key, unit: "units" };
const heroStatus = (parts: SectionAutosaveStatus[]): SectionAutosaveStatus => (["error", "saving", "saved"] as const).find((item) => parts.includes(item)) ?? "idle";

export function PricingHeaderActions({ priceListId, modifiers, materials }: { priceListId: string | null; modifiers: Modifiers; materials: Material[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Sheet>
        <SheetTrigger render={<Button variant="outline" />}>Property adjustments</SheetTrigger>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Property adjustments</SheetTitle><SheetDescription>Slope, narrow gates, first cut, and minimum charge.</SheetDescription></SheetHeader>
          <div className="px-4 pb-4">{priceListId ? <ModifiersForm priceListId={priceListId} modifiers={modifiers} /> : <p className="text-sm text-muted-foreground">No price list yet.</p>}</div>
        </SheetContent>
      </Sheet>
      <Sheet>
        <SheetTrigger render={<Button variant="outline" />}>Materials</SheetTrigger>
        <SheetContent className="overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>Materials</SheetTitle><SheetDescription>Used by assemblies and catalog markups.</SheetDescription></SheetHeader>
          <div className="px-4 pb-4"><MaterialsPanel materials={materials.map((item) => ({ ...item, unit_cost: Number(item.unit_cost) }))} /></div>
        </SheetContent>
      </Sheet>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>New service</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>New service</DialogTitle><DialogDescription>Name and category. Price tiers open next.</DialogDescription></DialogHeader>
          <ServiceForm onCreated={(id) => { setOpen(false); router.push(`/settings/pricing?service=${id}&tab=tiers`); router.refresh(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PricingStudio({ priceListId, services, rules, modifiers, canEdit, initialServiceId, initialTab }: {
  priceListId: string | null; services: StudioService[]; rules: StudioRule[]; modifiers: Modifiers; canEdit: boolean; initialServiceId: string | null; initialTab: string;
}) {
  const router = useRouter();
  const clickLock = useRef({ at: 0 });
  const [serviceId, setServiceId] = useState(initialServiceId && services.some((item) => item.id === initialServiceId) ? initialServiceId : (services[0]?.id ?? ""));
  const [trackedService, setTrackedService] = useState(initialServiceId);
  const [tab, setTab] = useState(initialTab);
  const [trackedTab, setTrackedTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [pickedRuleId, setPickedRuleId] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  if (initialServiceId !== trackedService) {
    setTrackedService(initialServiceId);
    if (initialServiceId && services.some((item) => item.id === initialServiceId)) setServiceId(initialServiceId);
  }
  if (initialTab !== trackedTab) { setTrackedTab(initialTab); setTab(initialTab); }

  const service = services.find((item) => item.id === serviceId) ?? null;
  const serviceRules = rules.filter((rule) => rule.serviceId === serviceId);
  const rule = serviceRules.find((item) => item.id === pickedRuleId) ?? serviceRules.find((item) => asTier(item.config)) ?? serviceRules[0] ?? null;
  const tier = rule ? asTier(rule.config) : null;
  const visit = (nextService: string, nextTab: string) => router.replace(`/settings/pricing?service=${nextService}&tab=${nextTab}`, { scroll: false });
  const visible = services.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (id: string) => { setServiceId(id); setPickedRuleId(null); visit(id, tab); };
  const createTiers = () => {
    if (!canEdit || !allowClick(clickLock.current, Date.now()) || !service || !priceListId) return;
    const fd = new FormData();
    fd.set("price_list_id", priceListId); fd.set("service_id", service.id); fd.set("name", "Price tiers"); fd.set("config", STARTER);
    void saveRule(fd).then((result) => { if (!result.ok) toast.error(result.error); else { setPickedRuleId(result.data.id); router.refresh(); } });
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="hidden p-3 lg:block">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" className="pl-8" aria-label="Search services" />
        </div>
        {KINDS.map(([kind, label]) => {
          const rows = visible.filter((item) => item.kind === kind);
          if (!rows.length) return null;
          return (
            <div key={kind}>
              <div className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
              {rows.map((item) => (
                <button key={item.id} type="button" onClick={() => pick(item.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${item.id === serviceId ? "bg-accent font-medium" : "hover:bg-muted"}`}>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{span(rules.find((ruleItem) => ruleItem.serviceId === item.id)?.config)}</span>
                </button>
              ))}
            </div>
          );
        })}
        {visible.length === 0 ? <p className="px-2 py-6 text-sm text-muted-foreground">No matching services.</p> : null}
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <NativeSelect className="lg:hidden" aria-label="Service" value={serviceId} onChange={(event) => pick(event.target.value)}>
          {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect>
        {service && rule && tier ? (
          <ServiceEditor key={service.id} service={service} rule={rule} tier={tier} rules={serviceRules} modifiers={modifiers} priceListId={priceListId} canEdit={canEdit} tab={tab} onTab={(value) => { setTab(value); visit(service.id, value); }} onPickRule={setPickedRuleId} onJson={() => setJsonOpen(true)} />
        ) : (
          <SectionCard title={service?.name ?? "Services"} description={service ? `${service.name} has no tier price yet.` : "Add a service to set prices."}>
            {canEdit && service && priceListId && !rule ? <Button variant="outline" className="w-fit" onClick={createTiers}>Add price tiers</Button> : null}
            {canEdit && service && rule && !tier ? <Button variant="outline" className="w-fit" onClick={() => setJsonOpen(true)}>Edit as JSON</Button> : null}
          </SectionCard>
        )}
      </div>
      <Sheet open={jsonOpen} onOpenChange={setJsonOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>Edit as JSON</SheetTitle><SheetDescription>Advanced.</SheetDescription></SheetHeader>
          <div className="hidden px-4 pb-4 lg:block">
            {rule && priceListId ? <RuleForm priceListId={priceListId} services={services.map((item) => ({ id: item.id, name: item.name }))} rule={{ id: rule.id, service_id: rule.serviceId, name: rule.name, config: JSON.stringify(rule.config, null, 2) }} showDelete={false} onClose={() => { setJsonOpen(false); router.refresh(); }} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function addTier(rule: TierMatrixRule): TierMatrixRule {
  const rows = rule.rows.map((row) => ({ ...row }));
  const last = rows[rows.length - 1];
  if (!last) return rule;
  if (last.upTo == null) { last.upTo = (rows[rows.length - 2]?.upTo ?? 0) + 5000; rows.push({ upTo: null, price: last.price, hours: last.hours, cost: last.cost }); }
  else rows.push({ upTo: last.upTo + 5000, price: last.price, hours: last.hours, cost: last.cost });
  return { ...rule, rows };
}

function ServiceEditor({ service, rule, tier, rules, modifiers, priceListId, canEdit, tab, onTab, onPickRule, onJson }: {
  service: StudioService; rule: StudioRule; tier: TierMatrixRule; rules: StudioRule[]; modifiers: Modifiers; priceListId: string | null; canEdit: boolean; tab: string;
  onTab: (tab: string) => void; onPickRule: (id: string | null) => void; onJson: () => void;
}) {
  const router = useRouter();
  const clickLock = useRef({ at: 0 });
  const [patch, setPatch] = useState<TierMatrixRule | null>(null);
  const [seenConfig, setSeenConfig] = useState(rule.config);
  const [tierIds, setTierIds] = useState(() => tier.rows.map((_, index) => `${rule.id}:${index}`));
  const [active, setActive] = useState(service.active);
  const [priceNote, setPriceNote] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  if (rule.config !== seenConfig) { const next = asTier(rule.config); setSeenConfig(rule.config); setPatch(null); setFormError(null); setTierIds((ids) => next && ids.length === next.rows.length ? ids : (next?.rows ?? []).map(() => crypto.randomUUID())); }
  const current = patch ?? tier;
  const unit = qtyOf(current.quantityKey).unit;
  const chips = QTY.some((item) => item.key === current.quantityKey) ? QTY : [...QTY, qtyOf(current.quantityKey)];
  const ruleSave = useSectionAutosave<RuleSave>({
    initial: { id: rule.id, serviceId: rule.serviceId, name: rule.name, config: tier },
    onRollback: (values) => { setPatch(values.config); setPriceNote(false); setTierIds(values.config.rows.map(() => crypto.randomUUID())); },
    action: async (values) => {
      if (!priceListId) return { ok: false, error: "No price list" };
      const fd = new FormData();
      fd.set("id", values.id); fd.set("price_list_id", priceListId); fd.set("service_id", values.serviceId); fd.set("name", values.name); fd.set("config", JSON.stringify(values.config));
      const result = await saveRule(fd); if (result.ok) router.refresh(); return result;
    },
  });
  const activeSave = useSectionAutosave<boolean>({ initial: service.active, onRollback: setActive, action: (on) => toggleService(service.id, on) });
  const descSave = useSectionAutosave<string>({ initial: service.description ?? "", action: (description) => { const fd = new FormData(); fd.set("id", service.id); fd.set("description", description); return updateService(fd); } });
  const [windowStart, setWindowStart] = useState(service.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(service.windowEnd ?? "");
  const [warnDate, setWarnDate] = useState(service.warnDate ?? "");
  const windowSave = useSectionAutosave<{ windowStart: string; windowEnd: string; warnDate: string }>({
    initial: {
      windowStart: service.windowStart ?? "",
      windowEnd: service.windowEnd ?? "",
      warnDate: service.warnDate ?? "",
    },
    onRollback: (values) => {
      setWindowStart(values.windowStart);
      setWindowEnd(values.windowEnd);
      setWarnDate(values.warnDate);
    },
    action: async (values) => {
      const fd = new FormData();
      fd.set("id", service.id);
      fd.set("window_start", values.windowStart);
      fd.set("window_end", values.windowEnd);
      fd.set("warn_date", values.warnDate);
      const result = await updateService(fd);
      if (result.ok) router.refresh();
      return result;
    },
  });
  const saveWindow = (next: { windowStart: string; windowEnd: string; warnDate: string }) => {
    setWindowStart(next.windowStart);
    setWindowEnd(next.windowEnd);
    setWarnDate(next.warnDate);
    windowSave.save(next, { immediate: true, rollback: true });
  };
  const commit = (next: TierMatrixRule, choice = false, note = false, ids?: string[]) => {
    const parsed = pricingRuleSchema.safeParse(next);
    if (!canEdit) return;
    if (!parsed.success || parsed.data.type !== "tier_matrix") {
      setFormError(parsed.success ? "Invalid tier" : (parsed.error.issues[0]?.message ?? "Invalid tier"));
      return;
    }
    setFormError(null);
    setPatch(parsed.data); if (ids) setTierIds(ids);
    if (note) setPriceNote(true);
    ruleSave.save({ id: rule.id, serviceId: rule.serviceId, name: rule.name, config: parsed.data }, tierSaveOptions(choice));
  };
  const setCell = (index: number, field: keyof TierRow, raw: string) => {
    const rows = current.rows.map((row) => ({ ...row }));
    const row = rows[index];
    if (!row) return;
    if (field === "upTo") { const next = raw.trim() === "" ? null : Number(raw.replace(/,/g, "")); if (next === row.upTo) return; row.upTo = next; }
    else { const next = Number(raw.replace(/[$,]/g, "")); if (next === row[field]) return; row[field] = next; }
    commit({ ...current, rows }, false, field === "price");
  };
  const error = formError ?? ruleSave.error ?? activeSave.error ?? descSave.error ?? windowSave.error;

  return (
    <>
      <SectionCard
        title={service.name}
        description={`Priced by ${qtyOf(current.quantityKey).label.toLowerCase()} · used on ${service.openQuotes} open ${service.openQuotes === 1 ? "quote" : "quotes"}`}
        status={heroStatus([ruleSave.status, activeSave.status, descSave.status, windowSave.status])}
        error={error}
        onRetry={() => {
          if (ruleSave.status === "error") ruleSave.retry();
          else if (activeSave.status === "error") activeSave.retry();
          else if (windowSave.status === "error") windowSave.retry();
          else descSave.retry();
        }}
        menu={canEdit ? <SectionMenu label="Service actions" items={[
          { id: "add", label: "Add tier", onSelect: () => { if (!allowClick(clickLock.current, Date.now())) return; commit(addTier(current), true, false, [...tierIds, crypto.randomUUID()]); } },
          { id: "json", label: "Edit as JSON", onSelect: onJson },
          { id: "copy", label: "Duplicate rule", onSelect: () => { if (!allowClick(clickLock.current, Date.now()) || !priceListId) return; const fd = new FormData(); fd.set("price_list_id", priceListId); fd.set("service_id", service.id); fd.set("name", `Copy of ${rule.name}`); fd.set("config", JSON.stringify(rule.config)); void saveRule(fd).then((result) => { if (!result.ok) toast.error(result.error); else { onPickRule(result.data.id); router.refresh(); } }); } },
          { id: "delete", label: "Delete rule", destructive: true, confirm: "Open quotes keep the price they already have.", onSelect: () => { void deleteRule(rule.id).then((result) => { if (!result.ok) toast.error(result.error); else { toast.success("Rule deleted"); onPickRule(null); router.refresh(); } }); } },
        ]} /> : undefined}
      >
        <div className="flex items-center gap-2">
          <Badge variant="outline">{kindLabel(service.kind)}</Badge>
          <label className="flex min-h-11 items-center gap-2 text-sm"><Switch checked={active} disabled={!canEdit} onCheckedChange={(checked) => { if (!canEdit) return; setActive(checked); activeSave.save(checked, { immediate: true, rollback: true }); }} />{active ? "On" : "Off"}</label>
        </div>
      </SectionCard>
      <TabBox label="Service" value={tab} onValueChange={onTab} tabs={[
        { value: "tiers", label: "Price tiers", content: (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Measured quantity</span>
              <ToggleGroup value={[current.quantityKey]} disabled={!canEdit} onValueChange={(next) => { const key = next[0]; if (canEdit && key && key !== current.quantityKey) commit({ ...current, quantityKey: key }, true); }} className="flex-wrap">
                {chips.map((item) => <ToggleGroupItem key={item.key} value={item.key} className="h-8 rounded-full border px-3 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground max-md:h-11">{item.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <div className="hidden grid-cols-[minmax(8rem,1.4fr)_7rem_5.5rem_6.5rem_2rem] gap-2 text-xs font-medium text-muted-foreground md:grid"><span>{qtyOf(current.quantityKey).label}</span><span>Price / visit</span><span className="inline-flex items-center gap-1"><Lock className="size-3" /> Hours</span><span className="inline-flex items-center gap-1"><Lock className="size-3" /> Cost</span><span /></div>
            {current.rows.map((row, index) => {
              const prev = index === 0 ? 0 : current.rows[index - 1]?.upTo;
              return (
                <div key={`${tierIds[index] ?? index}-${row.upTo}-${row.price}-${row.hours}-${row.cost}`} className="grid grid-cols-2 gap-2 border-t py-2 md:grid-cols-[minmax(8rem,1.4fr)_7rem_5.5rem_6.5rem_2rem] md:items-center">
                  <div className="col-span-2 text-sm tabular-nums md:col-span-1">{prev == null ? "And up" : `${(index === 0 ? 0 : Math.floor(prev) + 1).toLocaleString()} – `}<Input aria-label={`Up to tier ${index + 1}`} inputMode="numeric" readOnly={!canEdit} className="inline-flex h-8 w-24 tabular-nums max-md:h-11" defaultValue={row.upTo ?? ""} placeholder="no cap" onBlur={(event) => setCell(index, "upTo", event.target.value)} /></div>
                  <label className="block"><span className="mb-1 block text-xs text-muted-foreground md:hidden">Price, tier {index + 1}</span><Input aria-label={`Price, tier ${index + 1}`} data-weight="critical" inputMode="decimal" readOnly={!canEdit} className="h-8 tabular-nums max-md:h-11" defaultValue={row.price} onBlur={(event) => setCell(index, "price", event.target.value)} /></label>
                  <label className="block"><span className="mb-1 block text-xs text-muted-foreground md:hidden">Hours, tier {index + 1}</span><Input aria-label={`Hours, tier ${index + 1}`} data-weight="internal" inputMode="decimal" readOnly={!canEdit} className="h-8 border-dashed bg-muted tabular-nums max-md:h-11" defaultValue={row.hours} onBlur={(event) => setCell(index, "hours", event.target.value)} /></label>
                  <label className="block"><span className="mb-1 block text-xs text-muted-foreground md:hidden">Cost, tier {index + 1}</span><Input aria-label={`Cost, tier ${index + 1}`} data-weight="internal" inputMode="decimal" readOnly={!canEdit} className="h-8 border-dashed bg-muted tabular-nums max-md:h-11" defaultValue={row.cost} onBlur={(event) => setCell(index, "cost", event.target.value)} /></label>
                  {canEdit ? <Button type="button" variant="ghost" size="icon-sm" className="max-md:size-11" aria-label={`Remove tier ${index + 1}`} disabled={current.rows.length === 1} onClick={() => commit({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index) }, true, false, tierIds.filter((_, rowIndex) => rowIndex !== index))}>×</Button> : <span />}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
              {current.tail ? <>
                <span><b>Over {current.tail.over.toLocaleString()}:</b> every</span>
                <Input aria-label="Tail step" inputMode="numeric" readOnly={!canEdit} className="h-8 w-20 tabular-nums max-md:h-11" defaultValue={current.tail.every} onBlur={(event) => commit({ ...current, tail: { ...current.tail!, every: Number(event.target.value) } })} />
                <span>{unit} adds</span>
                <Input aria-label="Tail price" inputMode="decimal" readOnly={!canEdit} className="h-8 w-24 tabular-nums max-md:h-11" defaultValue={current.tail.addPrice} onBlur={(event) => commit({ ...current, tail: { ...current.tail!, addPrice: Number(event.target.value.replace(/[$,]/g, "")) } })} />
                <span className="text-muted-foreground">· {current.tail.addHours} h · {formatMoney(current.tail.addCost)}</span>
              </> : canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => commit({ ...current, tail: { every: 1000, over: [...current.rows].reverse().find((row) => row.upTo != null)?.upTo ?? 0, addPrice: 0, addHours: 0, addCost: 0 } }, true)}>Add over-range tail</Button> : <span className="text-muted-foreground">No over-range tail.</span>}
            </div>
            {priceNote && service.openQuotes > 0 ? <p className="text-sm text-muted-foreground">Open quotes keep their price. New quotes use this.</p> : null}
          </>
        ) },
        { value: "modifiers", label: "Modifiers that apply", content: MODS.filter(([key]) => modifiers[key] != null).length === 0
          ? <p className="text-sm text-muted-foreground">No property modifiers yet. Set slope, gate, and obstacles under Property adjustments.</p>
          : MODS.filter(([key]) => modifiers[key] != null).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3 border-b py-2 last:border-0">
              <span className="font-medium">{label}</span>
              <Switch checked={!(current.skipModifiers ?? []).includes(key)} disabled={!canEdit} onCheckedChange={(checked) => { if (!canEdit) return; const skip = new Set(current.skipModifiers ?? []); if (checked) skip.delete(key); else skip.add(key); commit({ ...current, skipModifiers: [...skip] }, true); }} />
            </label>
          )) },
        { value: "details", label: "Details", content: (
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="svc-desc">Description</FieldLabel>
              <Textarea id="svc-desc" key={service.id} rows={3} readOnly={!canEdit} defaultValue={service.description ?? ""} onBlur={(event) => { if (canEdit && event.target.value !== (service.description ?? "")) descSave.save(event.target.value); }} />
            </Field>
            <div className="grid gap-3" data-testid="seasonal-service-window">
              <p className="text-sm text-muted-foreground">
                Seasonal one-time window. Unscheduled jobs turn red after the warn date.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="svc-window-start">Window start</FieldLabel>
                  <Input
                    id="svc-window-start"
                    type="date"
                    readOnly={!canEdit}
                    value={windowStart}
                    onChange={(event) => setWindowStart(event.target.value)}
                    onBlur={() => {
                      if (!canEdit) return;
                      saveWindow({ windowStart, windowEnd, warnDate });
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="svc-warn-date">Warn date</FieldLabel>
                  <Input
                    id="svc-warn-date"
                    type="date"
                    readOnly={!canEdit}
                    value={warnDate}
                    onChange={(event) => setWarnDate(event.target.value)}
                    onBlur={() => {
                      if (!canEdit) return;
                      saveWindow({ windowStart, windowEnd, warnDate });
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="svc-window-end">Window end</FieldLabel>
                  <Input
                    id="svc-window-end"
                    type="date"
                    readOnly={!canEdit}
                    value={windowEnd}
                    onChange={(event) => setWindowEnd(event.target.value)}
                    onBlur={() => {
                      if (!canEdit) return;
                      saveWindow({ windowStart, windowEnd, warnDate });
                    }}
                  />
                </Field>
              </div>
            </div>
            {rules.length > 1 ? <NativeSelect aria-label="Price rule" value={rule.id} onChange={(event) => onPickRule(event.target.value)}>{rules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect> : <p className="text-sm text-muted-foreground">Rule · {rule.name}</p>}
          </div>
        ) },
      ]} />
    </>
  );
}
