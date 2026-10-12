"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Modifiers } from "@lawnquoter/pricing-engine";
import { MoreDisclosure, SectionCard, ToggleRow } from "@/components/entry";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import { saveModifiers } from "./actions";
import { fieldsToModifiers, modifierExamples, modifierFieldsSchema, modifiersToFields, type ModifierFields } from "./modifier-fields";
import { NumberBox } from "./number-box";

const SAMPLE_VISIT = 55;

function Example({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">Example: {children}</p>;
}

export function ModifiersForm({ priceListId, modifiers, canEdit = true }: { priceListId: string; modifiers: Modifiers; canEdit?: boolean }) {
  const router = useRouter();
  const saved = useMemo(() => modifiersToFields(modifiers), [modifiers]);
  const [fields, setFields] = useState<ModifierFields>(saved);
  const [seen, setSeen] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (saved !== seen) {
    setSeen(saved);
    setFields(saved);
    setError(null);
  }
  const set = <K extends keyof ModifierFields>(key: K, value: ModifierFields[K]) => setFields((prev) => ({ ...prev, [key]: value }));
  const valid = modifierFieldsSchema.safeParse(fields);
  const ex = valid.success ? modifierExamples(fieldsToModifiers(valid.data), SAMPLE_VISIT) : null;
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const off = !canEdit || pending;

  return (
    <SectionCard
      title="Property adjustments"
      hint={
        <HelpTip
          label="Help for property adjustments"
          text="Slope, a narrow gate, the drive, a dense route, and the season change the price on top of every service."
          href="/help/pricing#slope-gate-obstacles-and-stairs"
        />
      }
      description="Automatic price changes for tricky yards. They apply on top of every service's price."
      error={error}
      actions={
        canEdit ? (
          <>
            <Button
              type="button"
              disabled={pending || !dirty || !valid.success}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveModifiers(priceListId, fields);
                  if (result.ok) {
                    setError(null);
                    router.refresh();
                  } else setError(result.error);
                })
              }
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
            <Button type="button" variant="outline" disabled={pending || !dirty} onClick={() => { setFields(saved); setError(null); }}>
              Cancel
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-1">
          <NumberBox label="Minimum charge per visit" prefix="$" value={fields.minimumPrice} onChange={(v) => set("minimumPrice", v)} disabled={off} />
          {ex ? <Example>a {formatMoney(10)} job is billed {formatMoney(ex.small)}.</Example> : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="Hilly yards cost more" description="Add a percentage for sloped yards." checked={fields.slopeOn} disabled={off} onCheckedChange={(v) => set("slopeOn", v)} />
          {fields.slopeOn ? (
            <>
              <div className="flex flex-wrap gap-3">
                {(["gentle", "moderate", "steep"] as const).map((level) => (
                  <NumberBox key={level} label={`${level[0]!.toUpperCase()}${level.slice(1)} slope: add`} suffix="%" max={200} value={fields.slopePct[level]} onChange={(v) => set("slopePct", { ...fields.slopePct, [level]: v })} disabled={off} />
                ))}
              </div>
              {ex ? <Example>steep yard: a {formatMoney(SAMPLE_VISIT)} visit becomes {formatMoney(ex.steep)}.</Example> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="Narrow gate charge" description="For gates too narrow for a riding mower." checked={fields.gateOn} disabled={off} onCheckedChange={(v) => set("gateOn", v)} />
          {fields.gateOn ? (
            <>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="Gates narrower than" suffix="in" min={1} max={240} value={fields.gateInches} onChange={(v) => set("gateInches", v)} disabled={off} />
                <NumberBox label="Add" prefix="$" value={fields.gatePrice} onChange={(v) => set("gatePrice", v)} disabled={off} />
              </div>
              {ex ? <Example>a {formatMoney(SAMPLE_VISIT)} visit behind a narrow gate becomes {formatMoney(ex.narrowGate)}.</Example> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="First cut of the season costs more" description="For overgrown grass on the first visit." checked={fields.firstCutOn} disabled={off} onCheckedChange={(v) => set("firstCutOn", v)} />
          {fields.firstCutOn ? (
            <>
              <NumberBox label="Add" suffix="%" max={200} value={fields.firstCutPct} onChange={(v) => set("firstCutPct", v)} disabled={off} />
              {ex ? <Example>a {formatMoney(SAMPLE_VISIT)} first cut becomes {formatMoney(ex.firstCut)}.</Example> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="Trip charge by drive time and distance" description="The closest zone that fits every drive measure you know. Farther is anything beyond town." checked={fields.travelOn} disabled={off} onCheckedChange={(v) => set("travelOn", v)} />
          {fields.travelOn ? (
            <>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="Nearby, within" suffix="min" min={1} max={600} value={fields.nearbyMinutes} onChange={(v) => set("nearbyMinutes", v)} disabled={off} />
                <NumberBox label="and" suffix="mi" min={0.1} max={200} value={fields.nearbyMiles} onChange={(v) => set("nearbyMiles", v)} disabled={off} />
                <NumberBox label="Add" prefix="$" value={fields.nearbyPrice} onChange={(v) => set("nearbyPrice", v)} disabled={off} />
              </div>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="Town, within" suffix="min" min={1} max={600} value={fields.townMinutes} onChange={(v) => set("townMinutes", v)} disabled={off} />
                <NumberBox label="and" suffix="mi" min={0.1} max={200} value={fields.townMiles} onChange={(v) => set("townMiles", v)} disabled={off} />
                <NumberBox label="Add" prefix="$" value={fields.townPrice} onChange={(v) => set("townPrice", v)} disabled={off} />
              </div>
              <NumberBox label="Farther, add" prefix="$" value={fields.farPrice} onChange={(v) => set("farPrice", v)} disabled={off} />
              {ex ? <Example>a 45 minute, 30 mile drive on a {formatMoney(SAMPLE_VISIT)} visit becomes {formatMoney(ex.farDrive)}.</Example> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="Discount stops on a dense route" description="When enough other properties are already nearby." checked={fields.densityOn} disabled={off} onCheckedChange={(v) => set("densityOn", v)} />
          {fields.densityOn ? (
            <>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="At least" suffix="stops" min={1} max={50} value={fields.densityStops} onChange={(v) => set("densityStops", v)} disabled={off} />
                <NumberBox label="within" suffix="mi" min={0.1} max={50} value={fields.densityMiles} onChange={(v) => set("densityMiles", v)} disabled={off} />
                <NumberBox label="Take off" suffix="%" max={50} value={fields.densityPct} onChange={(v) => set("densityPct", v)} disabled={off} />
              </div>
              {ex ? <Example>a {formatMoney(SAMPLE_VISIT)} visit with that many neighbors becomes {formatMoney(ex.denseRoute)}.</Example> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <ToggleRow label="Seasonal price change" description="Percent added or taken off, by the month the quote is priced." checked={fields.seasonOn} disabled={off} onCheckedChange={(v) => set("seasonOn", v)} />
          {fields.seasonOn ? (
            <>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="Spring" suffix="%" min={-50} max={100} value={fields.springPct} onChange={(v) => set("springPct", v)} disabled={off} />
                <NumberBox label="Summer" suffix="%" min={-50} max={100} value={fields.summerPct} onChange={(v) => set("summerPct", v)} disabled={off} />
                <NumberBox label="Fall" suffix="%" min={-50} max={100} value={fields.fallPct} onChange={(v) => set("fallPct", v)} disabled={off} />
                <NumberBox label="Winter" suffix="%" min={-50} max={100} value={fields.winterPct} onChange={(v) => set("winterPct", v)} disabled={off} />
              </div>
              {ex ? <Example>a {formatMoney(SAMPLE_VISIT)} summer visit becomes {formatMoney(ex.summer)}.</Example> : null}
            </>
          ) : null}
        </div>

        <MoreDisclosure label="More options">
          <div className="grid gap-5 pt-2">
            <div className="grid gap-2">
              <ToggleRow label="Charge for obstacles" description="Trampolines, play sets, flower beds to mow around." checked={fields.obstacleOn} disabled={off} onCheckedChange={(v) => set("obstacleOn", v)} />
              {fields.obstacleOn ? (
                <div className="flex flex-wrap gap-3">
                  <NumberBox label="Add per obstacle" prefix="$" value={fields.obstaclePrice} onChange={(v) => set("obstaclePrice", v)} disabled={off} />
                  <NumberBox label="Extra time per obstacle" suffix="min" max={600} value={fields.obstacleMinutes} onChange={(v) => set("obstacleMinutes", v)} disabled={off} />
                </div>
              ) : null}
              {fields.obstacleOn && ex ? <Example>3 obstacles turn a {formatMoney(SAMPLE_VISIT)} visit into {formatMoney(ex.obstacles)}.</Example> : null}
            </div>
            <div className="grid gap-2">
              <ToggleRow label="Charge for stairs" description="Carrying equipment up steps." checked={fields.stairsOn} disabled={off} onCheckedChange={(v) => set("stairsOn", v)} />
              {fields.stairsOn ? (
                <div className="flex flex-wrap gap-3">
                  <NumberBox label="Add" prefix="$" value={fields.stairsPrice} onChange={(v) => set("stairsPrice", v)} disabled={off} />
                  <NumberBox label="Extra time" suffix="min" max={600} value={fields.stairsMinutes} onChange={(v) => set("stairsMinutes", v)} disabled={off} />
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Extra crew time (used for scheduling, not shown to customers)</p>
              <div className="flex flex-wrap gap-3">
                <NumberBox label="Minimum visit length" suffix="min" max={600} value={fields.minimumMinutes} onChange={(v) => set("minimumMinutes", v)} disabled={off} />
                {fields.gateOn ? <NumberBox label="Narrow gate adds" suffix="min" max={600} value={fields.gateMinutes} onChange={(v) => set("gateMinutes", v)} disabled={off} /> : null}
                {fields.slopeOn
                  ? (["gentle", "moderate", "steep"] as const).map((level) => (
                      <NumberBox key={level} label={`${level[0]!.toUpperCase()}${level.slice(1)} slope: more time`} suffix="%" max={200} value={fields.slopeTimePct[level]} onChange={(v) => set("slopeTimePct", { ...fields.slopeTimePct, [level]: v })} disabled={off} />
                    ))
                  : null}
              </div>
            </div>
          </div>
        </MoreDisclosure>
        {!valid.success ? <p className="text-sm text-destructive">{valid.error.issues[0]?.message}</p> : null}
      </div>
    </SectionCard>
  );
}
