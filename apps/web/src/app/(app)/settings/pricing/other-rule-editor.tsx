"use client";

import { useState, useTransition } from "react";
import { pricingRuleSchema, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { MoreDisclosure, SectionCard, Stepper } from "@/components/entry";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";

import { NumberBox } from "./number-box";
import { quantityLabel, ruleExample } from "./rule-labels";

type NonTier = Exclude<PricingRule, { type: "tier_matrix" }>;

export const RULE_TITLES: Record<NonTier["type"], string> = {
  program: "Season program",
  snow: "Snow pricing",
  irrigation: "Price per sprinkler zone",
  catalog: "Cost plus markup",
  assembly: "Built from labor and materials",
};

const pct = (frac: number) => Math.round(frac * 10000) / 100;
const frac = (p: number) => Math.round(p * 100) / 10000;

/** Plain editor for every non-tier rule. Saves validated engine config; no JSON is shown. */
export function OtherRuleEditor({
  serviceName,
  config,
  modifiers,
  canEdit,
  onSave,
}: {
  serviceName: string;
  config: NonTier;
  modifiers: Modifiers;
  canEdit: boolean;
  onSave: (config: PricingRule) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [rule, setRule] = useState<NonTier>(config);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const off = !canEdit || pending;
  const valid = pricingRuleSchema.safeParse(rule);
  const example = valid.success ? ruleExample(valid.data, modifiers) : null;
  const dirty = JSON.stringify(rule) !== JSON.stringify(config);
  const patch = (next: Partial<NonTier>) => setRule((prev) => ({ ...prev, ...next }) as NonTier);

  return (
    <SectionCard
      title={serviceName}
      description={`${RULE_TITLES[rule.type]} · changes apply to new quotes, open quotes keep their price`}
      error={error ?? (valid.success ? null : (valid.error.issues[0]?.message ?? null))}
      actions={
        canEdit ? (
          <>
            <Button
              type="button"
              disabled={off || !dirty || !valid.success}
              onClick={() =>
                startTransition(async () => {
                  const result = await onSave(rule);
                  setError(result.ok ? null : result.error);
                })
              }
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
            <Button type="button" variant="outline" disabled={off || !dirty} onClick={() => { setRule(config); setError(null); }}>Cancel</Button>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <HelpTip
          label="Help for this price rule"
          text="These amounts price new quotes. Snow depth, zone price, and markup each follow the rule you picked."
          href="/help/pricing#other-ways-to-price-a-service"
        />
        {rule.type === "program" ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1 text-sm"><span className="text-muted-foreground">Applications per year</span><Stepper label="Applications per year" min={1} max={20} value={rule.applicationCount} onValueChange={(v) => canEdit && patch({ applicationCount: v })} /></div>
              <NumberBox label="Price per application" prefix="$" value={rule.perApp.price} onChange={(v) => patch({ perApp: { ...rule.perApp, price: v } })} disabled={off} />
            </div>
            <label className="grid max-w-sm gap-1 text-sm">
              <span className="text-muted-foreground">How customers pay</span>
              <NativeSelect value={rule.billing} disabled={off} onChange={(e) => patch({ billing: e.target.value as "per_app" | "prepay" })}>
                <option value="per_app">Bill after each application</option>
                <option value="prepay">Prepay for the whole season</option>
              </NativeSelect>
            </label>
            {rule.billing === "prepay" ? (
              <>
                <NumberBox label="Prepay discount" suffix="%" max={50} value={pct(rule.prepayDiscountPct)} onChange={(v) => patch({ prepayDiscountPct: frac(v) })} disabled={off} />
                <p className="text-sm text-muted-foreground">The highest application count this program meets replaces the discount above.</p>
                {(rule.prepayTiers ?? []).map((tier, index) => (
                  <div key={index} className="flex flex-wrap items-end gap-3">
                    <NumberBox label="At least" suffix="apps" min={1} max={24} value={tier.minApps} onChange={(v) => patch({ prepayTiers: (rule.prepayTiers ?? []).map((row, i) => (i === index ? { ...row, minApps: Math.max(1, Math.round(v)) } : row)) })} disabled={off} />
                    <NumberBox label="Off" suffix="%" max={50} value={pct(tier.discountPct)} onChange={(v) => patch({ prepayTiers: (rule.prepayTiers ?? []).map((row, i) => (i === index ? { ...row, discountPct: frac(v) } : row)) })} disabled={off} />
                    <Button type="button" variant="ghost" disabled={off} onClick={() => patch({ prepayTiers: (rule.prepayTiers ?? []).filter((_, i) => i !== index) })}>Remove</Button>
                  </div>
                ))}
                {(rule.prepayTiers ?? []).length < 6 && (rule.prepayTiers?.at(-1)?.minApps ?? 0) < 24 ? (
                  <Button type="button" variant="outline" className="w-fit" disabled={off} onClick={() => patch({ prepayTiers: [...(rule.prepayTiers ?? []), { minApps: Math.min(24, (rule.prepayTiers?.at(-1)?.minApps ?? 2) + 2), discountPct: 0.05 }] })}>Add application discount</Button>
                ) : null}
              </>
            ) : null}
            <MoreDisclosure label="More options">
              <div className="flex flex-wrap gap-3 pt-2">
                <NumberBox label="Crew hours per application" suffix="h" value={rule.perApp.hours} onChange={(v) => patch({ perApp: { ...rule.perApp, hours: v } })} disabled={off} />
                <NumberBox label="Your cost per application" prefix="$" value={rule.perApp.cost} onChange={(v) => patch({ perApp: { ...rule.perApp, cost: v } })} disabled={off} />
              </div>
            </MoreDisclosure>
          </>
        ) : null}

        {rule.type === "snow" ? (
          <>
            <div className="grid min-w-0 max-w-full gap-1 text-sm sm:max-w-sm">
              <label htmlFor="snow-contract" className="text-muted-foreground">How you charge</label>
              <NativeSelect
                id="snow-contract"
               
                value={rule.contract}
                disabled={off}
                onChange={(e) => {
                  const contract = e.target.value as "per_push" | "per_inch" | "seasonal_flat";
                  const zero = { price: 0, hours: 0, cost: 0 };
                  patch({
                    contract,
                    perPush: contract === "per_push" ? (rule.perPush ?? zero) : rule.perPush,
                    seasonal: contract === "seasonal_flat" ? (rule.seasonal ?? zero) : rule.seasonal,
                    inchTiers: contract === "per_inch" ? (rule.inchTiers ?? [{ upTo: 4, ...zero }, { upTo: null, ...zero }]) : rule.inchTiers,
                  } as Partial<NonTier>);
                }}
              >
                <option value="per_push">Per visit (each plow)</option>
                <option value="per_inch">By snow depth</option>
                <option value="seasonal_flat">One price for the season</option>
              </NativeSelect>
            </div>
            {rule.contract === "per_push" ? <NumberBox label="Price per visit" prefix="$" value={rule.perPush?.price ?? 0} onChange={(v) => patch({ perPush: { hours: 0, cost: 0, ...rule.perPush, price: v } })} disabled={off} /> : null}
            {rule.contract === "seasonal_flat" ? <NumberBox label="Season price" prefix="$" value={rule.seasonal?.price ?? 0} onChange={(v) => patch({ seasonal: { hours: 0, cost: 0, ...rule.seasonal, price: v } })} disabled={off} /> : null}
            {rule.contract === "per_inch" ? (
              <div className="grid gap-2">
                {(rule.inchTiers ?? []).map((row, i, rows) => (
                  <div key={i} className="flex flex-wrap items-end gap-3">
                    {row.upTo == null ? <span className="pb-2 text-sm">More than {rows[i - 1]?.upTo ?? 0} in</span> : <NumberBox label={`Up to (tier ${i + 1})`} suffix="in" min={0.5} value={row.upTo} onChange={(v) => patch({ inchTiers: rows.map((r, j) => (j === i ? { ...r, upTo: v } : r)) })} disabled={off} />}
                    <NumberBox label="Price" prefix="$" value={row.price} onChange={(v) => patch({ inchTiers: rows.map((r, j) => (j === i ? { ...r, price: v } : r)) })} disabled={off} />
                  </div>
                ))}
              </div>
            ) : null}
            <NumberBox label="Come out when snow reaches" suffix="in" value={rule.triggerDepthIn} onChange={(v) => patch({ triggerDepthIn: v })} disabled={off} />
          </>
        ) : null}

        {rule.type === "irrigation" ? (
          <>
            <NumberBox label="Price per zone" prefix="$" value={rule.pricePerZone} onChange={(v) => patch({ pricePerZone: v })} disabled={off} />
            <MoreDisclosure label="More options">
              <div className="flex flex-wrap gap-3 pt-2">
                <NumberBox label="Crew time per zone" suffix="min" value={rule.minutesPerZone} onChange={(v) => patch({ minutesPerZone: v })} disabled={off} />
                <NumberBox label="Your cost per zone" prefix="$" value={rule.costPerZone} onChange={(v) => patch({ costPerZone: v })} disabled={off} />
              </div>
            </MoreDisclosure>
          </>
        ) : null}

        {rule.type === "catalog" ? (
          <>
            <div className="flex flex-wrap gap-3">
              <NumberBox label="Materials cost you" prefix="$" value={rule.materialCost} onChange={(v) => patch({ materialCost: v })} disabled={off} />
              <NumberBox label="Materials markup" suffix="%" max={500} value={pct(rule.materialMarkupPct)} onChange={(v) => patch({ materialMarkupPct: frac(v) })} disabled={off} />
            </div>
            <div className="flex flex-wrap gap-3">
              <NumberBox label="Labor cost you" prefix="$" value={rule.laborCost} onChange={(v) => patch({ laborCost: v })} disabled={off} />
              <NumberBox label="Labor markup" suffix="%" max={500} value={pct(rule.laborMarkupPct)} onChange={(v) => patch({ laborMarkupPct: frac(v) })} disabled={off} />
            </div>
            <MoreDisclosure label="More options">
              <div className="pt-2"><NumberBox label="Crew hours" suffix="h" value={rule.laborHours} onChange={(v) => patch({ laborHours: v })} disabled={off} /></div>
            </MoreDisclosure>
          </>
        ) : null}

        {rule.type === "assembly" ? (
          <>
            <p className="text-sm text-muted-foreground">Priced from the work per {quantityLabel(rule.quantityKey).unit} of {quantityLabel(rule.quantityKey).label.toLowerCase()}, then your overhead and profit.</p>
            {rule.items.map((item, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3 border-t pt-3">
                <span className="w-full text-sm font-medium">{item.name} · {item.kind === "material" ? "material" : item.kind === "labor" ? "labor" : "equipment"}</span>
                {item.kind === "material" ? (
                  <>
                    <NumberBox label="Cost per unit" prefix="$" value={item.unitCost} onChange={(v) => patch({ items: rule.items.map((it, j) => (j === i ? { ...item, unitCost: v } : it)) })} disabled={off} />
                    <NumberBox label={`Units per ${quantityLabel(rule.quantityKey).unit}`} value={item.qtyPerUnit} onChange={(v) => patch({ items: rule.items.map((it, j) => (j === i ? { ...item, qtyPerUnit: v } : it)) })} disabled={off} />
                  </>
                ) : (
                  <>
                    <NumberBox label="Hourly rate" prefix="$" suffix="/h" value={item.hourlyRate} onChange={(v) => patch({ items: rule.items.map((it, j) => (j === i ? { ...item, hourlyRate: v } : it)) })} disabled={off} />
                    <NumberBox label={`Hours per ${quantityLabel(rule.quantityKey).unit}`} value={item.hoursPerUnit} onChange={(v) => patch({ items: rule.items.map((it, j) => (j === i ? { ...item, hoursPerUnit: v } : it)) })} disabled={off} />
                  </>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-3 border-t pt-3">
              <NumberBox label="Overhead" suffix="%" max={200} value={pct(rule.overheadPct)} onChange={(v) => patch({ overheadPct: frac(v) })} disabled={off} />
              <NumberBox label="Profit margin" suffix="%" max={95} value={pct(rule.targetMarginPct)} onChange={(v) => patch({ targetMarginPct: frac(v) })} disabled={off} />
            </div>
          </>
        ) : null}

        {example ? <p className="text-sm" data-testid="rule-example">Example: {example.text} costs <b>{formatMoney(example.price)}</b>.</p> : null}
      </div>
    </SectionCard>
  );
}
