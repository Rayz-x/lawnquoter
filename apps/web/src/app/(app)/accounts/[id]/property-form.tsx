"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/supabase/types";
import { createProperty, updateProperty } from "../actions";

export function PropertyForm({
  accountId,
  property,
  access,
}: {
  accountId: string;
  property?: Tables<"properties">;
  access?: { gate_code: string | null; access_notes: string | null } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (property) {
        const r = await updateProperty(property.id, fd);
        if (r.ok) {
          toast.success("Property saved");
          r.data.warnings.forEach((w) => toast.warning(w));
          router.refresh();
        } else toast.error(r.error);
      } else {
        const r = await createProperty(accountId, fd);
        if (r.ok) {
          toast.success("Property added");
          r.data.warnings.forEach((w) => toast.warning(w));
          router.push(`/properties/${r.data.id}`);
        } else toast.error(r.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="p_name">Label (optional)</FieldLabel>
          <Input id="p_name" name="name" placeholder="Main house, Clubhouse, Lot 12…" defaultValue={property?.name ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="address_line1">Street address</FieldLabel>
          <Input id="address_line1" name="address_line1" required defaultValue={property?.address_line1 ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="address_line2">Unit / suite</FieldLabel>
          <Input id="address_line2" name="address_line2" defaultValue={property?.address_line2 ?? ""} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="city">City</FieldLabel>
            <Input id="city" name="city" required defaultValue={property?.city ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="region">State</FieldLabel>
            <Input id="region" name="region" required defaultValue={property?.region ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="postal_code">ZIP</FieldLabel>
            <Input id="postal_code" name="postal_code" required defaultValue={property?.postal_code ?? ""} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="gate_width_in">Gate width (inches)</FieldLabel>
            <Input id="gate_width_in" name="gate_width_in" type="number" min={0} max={240} defaultValue={property?.gate_width_in ?? ""} />
            <FieldDescription>Under 48 inches means push-mow only in back.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="slope">Slope</FieldLabel>
            <select id="slope" name="slope" defaultValue={property?.slope ?? ""} className="native-control">
              <option value="">Unknown</option>
              <option value="flat">Flat</option>
              <option value="gentle">Gentle</option>
              <option value="moderate">Moderate</option>
              <option value="steep">Steep</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="obstacle_count">Obstacles</FieldLabel>
            <Input id="obstacle_count" name="obstacle_count" type="number" min={0} defaultValue={property?.obstacle_count ?? 0} />
          </Field>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <Checkbox name="has_stairs" defaultChecked={property?.has_stairs ?? false} /> Stairs
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <Checkbox name="has_dogs" defaultChecked={property?.has_dogs ?? false} /> Dogs
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="gate_code">Gate code</FieldLabel>
            <Input id="gate_code" name="gate_code" defaultValue={access?.gate_code ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="zone">Route zone</FieldLabel>
            <Input id="zone" name="zone" placeholder="North, Zone 3…" defaultValue={property?.zone ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="access_notes">Access notes (customer-visible)</FieldLabel>
          <Textarea id="access_notes" name="access_notes" rows={2} defaultValue={access?.access_notes ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="crew_notes">Crew notes (internal)</FieldLabel>
          <Textarea id="crew_notes" name="crew_notes" rows={2} defaultValue={property?.crew_notes ?? ""} />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {property ? "Save property" : "Add property"}
      </Button>
    </form>
  );
}
