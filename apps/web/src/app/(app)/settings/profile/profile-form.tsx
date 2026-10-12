"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateProfile } from "../actions";

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [pending, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile(fd);
      if (result.ok) toast.success("Profile saved");
      else toast.error(result.error);
    });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="full_name">Full name</FieldLabel>
          <Input id="full_name" name="full_name" aria-describedby="full-name-hint" defaultValue={fullName} required />
          <FieldHint id="full-name-hint">Your name on quotes you send and on the team list.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">Mobile phone</FieldLabel>
          <Input id="phone" name="phone" aria-describedby="profile-phone-hint" defaultValue={phone} />
          <FieldHint id="profile-phone-hint">A number the office can use to reach you.</FieldHint>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
