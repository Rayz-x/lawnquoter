"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { deleteRule, saveRule } from "./actions";

const STARTER = `{
  "type": "tier_matrix",
  "quantityKey": "turf_sqft",
  "rows": [
    { "upTo": 5000, "price": 40, "hours": 0.5, "cost": 18 },
    { "upTo": 10000, "price": 55, "hours": 0.75, "cost": 24 },
    { "upTo": null, "price": 70, "hours": 1, "cost": 32 }
  ],
  "tail": { "every": 1000, "over": 15000, "addPrice": 5, "addHours": 0.08, "addCost": 2 }
}`;

export function RuleForm({
  priceListId,
  services,
  rule,
}: {
  priceListId: string;
  services: { id: string; name: string }[];
  rule?: { id: string; service_id: string; name: string; config: string };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await saveRule(fd);
          if (r.ok) toast.success("Rule saved");
          else toast.error(r.error);
        });
      }}
    >
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <input type="hidden" name="price_list_id" value={priceListId} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`name-${rule?.id ?? "new"}`}>Name</FieldLabel>
          <Input id={`name-${rule?.id ?? "new"}`} name="name" required defaultValue={rule?.name ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`svc-${rule?.id ?? "new"}`}>Service</FieldLabel>
          <select
            id={`svc-${rule?.id ?? "new"}`}
            name="service_id"
            required
            defaultValue={rule?.service_id ?? services[0]?.id}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`cfg-${rule?.id ?? "new"}`}>Rule JSON</FieldLabel>
          <Textarea id={`cfg-${rule?.id ?? "new"}`} name="config" rows={12} className="font-mono text-xs" defaultValue={rule?.config ?? STARTER} required />
          <FieldDescription>type: tier_matrix, assembly, catalog, program, snow, or irrigation. Always store price, hours, and cost.</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || services.length === 0}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save rule
        </Button>
        {rule ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteRule(rule.id);
                if (!r.ok) toast.error(r.error);
              })
            }
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
