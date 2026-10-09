"use client";

import { Trash2 } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Tables } from "@/lib/supabase/types";
import { addContact, deleteContact } from "../actions";

export function ContactsPanel({ accountId, contacts }: { accountId: string; contacts: Tables<"contacts">[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await addContact(accountId, fd);
      if (r.ok) {
        toast.success("Contact added");
        formRef.current?.reset();
      } else toast.error(r.error);
    });
  };

  const remove = (contactId: string) =>
    startTransition(async () => {
      const r = await deleteContact(accountId, contactId);
      if (!r.ok) toast.error(r.error);
    });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-3 lg:col-span-2">
        {contacts.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.phone}
                {c.is_primary ? <Badge variant="secondary">Primary</Badge> : null}
                {c.is_billing ? <Badge variant="outline">Billing</Badge> : null}
                <Badge variant="outline" className="capitalize">
                  {c.role.replace("_", " ")}
                </Badge>
              </CardTitle>
              <CardDescription>
                {[c.title, c.phone, c.email].filter(Boolean).join(" · ")}
                {c.sms_opt_in ? " · SMS ok" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(c.id)}>
                <Trash2 data-icon="inline-start" />
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
        {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts yet.</p> : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Add contact</CardTitle>
          <CardDescription>Site contact, billing contact, or decision maker.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="first_name">First name</FieldLabel>
                  <Input id="first_name" name="first_name" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="last_name">Last name</FieldLabel>
                  <Input id="last_name" name="last_name" />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="c_email">Email</FieldLabel>
                <Input id="c_email" name="email" type="email" />
              </Field>
              <Field>
                <FieldLabel htmlFor="c_phone">Mobile</FieldLabel>
                <Input id="c_phone" name="phone" />
              </Field>
              <Field>
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <select id="role" name="role" defaultValue="primary" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="primary">Primary</option>
                  <option value="billing">Billing</option>
                  <option value="site">Site contact</option>
                  <option value="decision_maker">Decision maker</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox name="is_primary" /> Primary contact
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox name="is_billing" /> Receives invoices
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox name="sms_opt_in" /> Consented to SMS
                </label>
              </div>
            </FieldGroup>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Add contact
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
