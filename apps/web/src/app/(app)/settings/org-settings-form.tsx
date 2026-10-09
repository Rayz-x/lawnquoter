"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Tables } from "@/lib/supabase/types";
import { updateOrgSettings } from "./actions";

export function OrgSettingsForm({ org }: { org: Tables<"orgs"> }) {
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateOrgSettings(fd);
      if (result.ok) toast.success("Settings saved");
      else toast.error(result.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Company name</FieldLabel>
          <Input id="name" name="name" defaultValue={org.name} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input id="phone" name="phone" defaultValue={org.phone ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" defaultValue={org.email ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="website">Website</FieldLabel>
          <Input id="website" name="website" defaultValue={org.website ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="address_line1">Address</FieldLabel>
          <Input id="address_line1" name="address_line1" defaultValue={org.address_line1 ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="address_line2">Address line 2</FieldLabel>
          <Input id="address_line2" name="address_line2" defaultValue={org.address_line2 ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="city">City</FieldLabel>
            <Input id="city" name="city" defaultValue={org.city ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="region">State</FieldLabel>
            <Input id="region" name="region" defaultValue={org.region ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="postal_code">ZIP</FieldLabel>
            <Input id="postal_code" name="postal_code" defaultValue={org.postal_code ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Input id="timezone" name="timezone" defaultValue={org.timezone} required />
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
