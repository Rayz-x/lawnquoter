"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Stepper } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveIrrigationPlan } from "@/lib/actions/irrigation-plan";

export function IrrigationPlanForm({
  agreementId,
  zones,
  minutesPerZone,
  pricePerZone,
}: {
  agreementId: string;
  zones: number | null;
  minutesPerZone: number | null;
  pricePerZone: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [zoneCount, setZoneCount] = useState(zones ?? 6);
  const [minutes, setMinutes] = useState(minutesPerZone != null ? String(minutesPerZone) : "8");
  const [price, setPrice] = useState(pricePerZone != null ? String(pricePerZone) : "12");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const minutesPer = Number(minutes);
        const priceEach = Number(price);
        if (!Number.isInteger(minutesPer) || minutesPer < 1) {
          toast.error("Minutes per zone are required");
          return;
        }
        if (!Number.isFinite(priceEach) || priceEach < 0) {
          toast.error("Price per zone is required");
          return;
        }
        startTransition(async () => {
          const result = await saveIrrigationPlan({
            agreementId,
            zones: zoneCount,
            minutesPerZone: minutesPer,
            pricePerZone: priceEach,
          });
          if (result.ok) {
            toast.success("Irrigation plan saved");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <Stepper label="Zones" value={zoneCount} min={1} max={200} onValueChange={setZoneCount} />
      <Field>
        <FieldLabel htmlFor="irr-minutes">Minutes per zone</FieldLabel>
        <Input id="irr-minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="irr-price">Price per zone</FieldLabel>
        <Input id="irr-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save irrigation plan
      </Button>
    </form>
  );
}
