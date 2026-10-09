"use client";

import { useMemo, useState } from "react";
import { priceLine, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PreviewCard({ rules, modifiers }: { rules: { name: string; rule: PricingRule }[]; modifiers: Modifiers }) {
  const [turf, setTurf] = useState(8000);
  const [zones, setZones] = useState(6);
  const [confidence, setConfidence] = useState(0.7);
  const [firstCut, setFirstCut] = useState(false);

  const rows = useMemo(
    () =>
      rules.map((r) => ({
        name: r.name,
        line: priceLine({
          rule: r.rule,
          quantities: { turf_sqft: turf, zones, inches: 3, visits: 1, each: 1 },
          context: { confidence, firstCut, slope: "gentle" },
          modifiers,
        }),
      })),
    [rules, turf, zones, confidence, firstCut, modifiers],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price a sample lot</CardTitle>
        <CardDescription>Uses the live engine. Low confidence emits a range instead of a binding price.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="prev_turf">Turf sq ft</FieldLabel>
            <Input id="prev_turf" type="number" value={turf} onChange={(e) => setTurf(Number(e.target.value))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="prev_zones">Irrigation zones</FieldLabel>
            <Input id="prev_zones" type="number" value={zones} onChange={(e) => setZones(Number(e.target.value))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="prev_conf">Measurement confidence (0–1)</FieldLabel>
            <Input id="prev_conf" type="number" min={0} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={firstCut} onChange={(e) => setFirstCut(e.target.checked)} />
            First cut
          </label>
        </FieldGroup>
        <div className="lg:col-span-2 flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <div key={r.name} className="rounded-md border p-3">
              <div className="font-medium">{r.name}</div>
              <div className="tabular-nums text-muted-foreground">
                <span className="font-heading text-foreground">${r.line.price.toFixed(2)}</span>
                {r.line.range
                  ? ` · range $${r.line.range.low.toFixed(2)} – $${r.line.range.high.toFixed(2)}`
                  : ""}
                {" · "}
                {r.line.hours.toFixed(2)} hrs · cost ${r.line.cost.toFixed(2)}
              </div>
            </div>
          ))}
          {rows.length === 0 ? <p className="text-muted-foreground">Add a rule to preview it.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
