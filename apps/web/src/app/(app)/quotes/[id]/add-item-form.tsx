"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addLineItem } from "../actions";

export function AddItemForm({ quoteId, versionId }: { quoteId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add line</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            startTransition(async () => {
              const r = await addLineItem(quoteId, versionId, fd);
              if (r.ok) {
                toast.success("Line added");
                form.reset();
              } else toast.error(r.error);
            });
          }}
        >
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="li_name">Name</FieldLabel>
            <Input id="li_name" name="name" required />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="li_desc">Description</FieldLabel>
            <Textarea id="li_desc" name="description" rows={2} />
          </Field>
          <Field>
            <FieldLabel htmlFor="li_state">State</FieldLabel>
            <select id="li_state" name="state" defaultValue="included" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="included">Included</option>
              <option value="recommended">Recommended</option>
              <option value="optional">Optional</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="li_tier">Good / Better / Best</FieldLabel>
            <select id="li_tier" name="option_tier" defaultValue="none" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="none">None</option>
              <option value="good">Good</option>
              <option value="better">Better</option>
              <option value="best">Best</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="li_group">Option group</FieldLabel>
            <Input id="li_group" name="option_group" placeholder="Mow package" />
          </Field>
          <Field>
            <FieldLabel htmlFor="li_photo">Photo URL</FieldLabel>
            <Input id="li_photo" name="photo_url" placeholder="https://…" />
          </Field>
          <Field>
            <FieldLabel htmlFor="li_price">Price</FieldLabel>
            <Input id="li_price" name="price" type="number" step="0.01" defaultValue={0} />
          </Field>
          <Field>
            <FieldLabel htmlFor="li_hours">Hours</FieldLabel>
            <Input id="li_hours" name="hours" type="number" step="0.05" defaultValue={0} />
          </Field>
          <Field>
            <FieldLabel htmlFor="li_cost">Cost</FieldLabel>
            <Input id="li_cost" name="cost" type="number" step="0.01" defaultValue={0} />
          </Field>
          <FieldGroup className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Add line
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
