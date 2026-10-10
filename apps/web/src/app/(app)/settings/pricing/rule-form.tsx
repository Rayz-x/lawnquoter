"use client";

import { useState, useTransition } from "react";
import { pricingRuleSchema } from "@lawnquoter/pricing-engine";
import { toast } from "sonner";
import { SectionCard } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { deleteRule, saveRule } from "./actions";

export const STARTER = `{
  "type": "tier_matrix",
  "quantityKey": "turf_sqft",
  "rows": [
    { "upTo": 5000, "price": 40, "hours": 0.5, "cost": 18 },
    { "upTo": 10000, "price": 55, "hours": 0.75, "cost": 24 },
    { "upTo": null, "price": 70, "hours": 1, "cost": 32 }
  ],
  "tail": { "every": 1000, "over": 15000, "addPrice": 5, "addHours": 0.08, "addCost": 2 }
}`;

function jsonIssues(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const pos = Number(/position (\d+)/.exec(String(error))?.[1] ?? 0);
    return [`Line ${text.slice(0, pos).split("\n").length}: Rule config must be valid JSON`];
  }
  const parsed = pricingRuleSchema.safeParse(json);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const row = issue.path.find((part) => typeof part === "number");
    const key = [...issue.path].reverse().find((part) => typeof part === "string");
    let line = 1;
    if (typeof key === "string") {
      let seen = 0;
      text.split("\n").some((source, index) => {
        if (!source.includes(`"${key}"`)) return false;
        if (typeof row === "number" && seen++ !== row) return false;
        line = index + 1;
        return true;
      });
    }
    return `Line ${line}: ${issue.message}`;
  });
}

export function RuleForm({
  priceListId,
  services,
  rule,
  onClose,
  showDelete = true,
}: {
  priceListId: string;
  services: { id: string; name: string }[];
  rule?: { id: string; service_id: string; name: string; config: string };
  onClose?: () => void;
  showDelete?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [issues, setIssues] = useState<string[]>([]);
  const formId = `rule-${rule?.id ?? "new"}`;
  return (
    <SectionCard
      title="Rule JSON"
      description="Advanced. Changes apply to new quotes."
      actions={
        <>
          <Button type="submit" form={formId} disabled={pending || services.length === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          {onClose ? (
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          {rule && showDelete ? (
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
        </>
      }
    >
    <form
      id={formId}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const found = jsonIssues(String(fd.get("config") ?? ""));
        setIssues(found);
        if (found.length) return;
        startTransition(async () => {
          const r = await saveRule(fd);
          if (r.ok) {
            toast.success("Rule saved");
            onClose?.();
          } else toast.error(r.error);
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
            className="native-control"
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
          {issues.length ? (
            <FieldError>
              <ul>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </FieldError>
          ) : null}
        </Field>
      </FieldGroup>
    </form>
    </SectionCard>
  );
}
