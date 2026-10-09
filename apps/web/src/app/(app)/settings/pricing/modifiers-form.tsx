"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { Modifiers } from "@lawnquoter/pricing-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { saveModifiers } from "./actions";

export function ModifiersForm({ priceListId, modifiers }: { priceListId: string; modifiers: Modifiers }) {
  const [pending, startTransition] = useTransition();
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Property modifiers</CardTitle>
        <CardDescription>Slope, gate width, bagging, first-cut, obstacles, travel, route density, and service minimums.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = await saveModifiers(fd);
              if (r.ok) toast.success("Modifiers saved");
              else toast.error(r.error);
            });
          }}
        >
          <input type="hidden" name="price_list_id" value={priceListId} />
          <Field>
            <FieldLabel htmlFor="modifiers">Modifiers JSON</FieldLabel>
            <Textarea id="modifiers" name="modifiers" rows={18} className="font-mono text-xs" defaultValue={JSON.stringify(modifiers, null, 2)} />
            <FieldDescription>Applied to every priced line after the rule runs.</FieldDescription>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save modifiers
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
