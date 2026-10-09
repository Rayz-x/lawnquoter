"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { ORG_ROLES } from "@lawnquoter/shared";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { inviteMember } from "../actions";

const INVITABLE = ORG_ROLES.filter((r) => r !== "owner");

export function InviteMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await inviteMember(fd);
      if (result.ok) {
        toast.success("Invitation sent");
        formRef.current?.reset();
      } else toast.error(result.error);
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input id="invite-email" name="email" type="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <select
            id="invite-role"
            name="role"
            defaultValue="crew"
            className="native-control"
          >
            {INVITABLE.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Send invite
      </Button>
    </form>
  );
}
