"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { createQuoteAndGo } from "../actions";

export function NewQuoteForm({
  accounts,
  properties,
  defaultAccountId,
}: {
  accounts: { id: string; name: string }[];
  properties: { id: string; formatted_address: string | null; account_id: string }[];
  defaultAccountId?: string;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const props = properties.filter((p) => p.account_id === accountId);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const acct = String(fd.get("account_id") ?? "");
        const prop = String(fd.get("property_id") ?? "");
        if (!acct) {
          toast.error("Pick an account");
          return;
        }
        startTransition(async () => {
          const result = await createQuoteAndGo(acct, prop || null);
          if (!result.ok) toast.error(result.error);
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account_id">Account</FieldLabel>
          <select
            id="account_id"
            name="account_id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
           
            className="native-control w-full"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="property_id">Property</FieldLabel>
          <select id="property_id" name="property_id" className="native-control w-full">
            <option value="">None yet</option>
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.formatted_address}
              </option>
            ))}
          </select>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending || accounts.length === 0}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Open builder
      </Button>
    </form>
  );
}
