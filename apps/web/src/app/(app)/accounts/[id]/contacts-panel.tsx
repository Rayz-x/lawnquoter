"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Tables } from "@/lib/supabase/types";
import { addContact, deleteContact } from "../actions";

export function ContactsPanel({
  accountId,
  contacts,
  canEdit = true,
}: {
  accountId: string;
  contacts: Tables<"contacts">[];
  canEdit?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("site");
  const [flags, setFlags] = useState<string[]>([]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const [first, ...rest] = name.trim().split(/\s+/);
    const fd = new FormData();
    fd.set("first_name", first ?? "");
    fd.set("last_name", rest.join(" "));
    fd.set("email", email);
    fd.set("phone", phone);
    fd.set("role", role);
    if (flags.includes("primary")) fd.set("is_primary", "true");
    if (flags.includes("billing")) fd.set("is_billing", "true");
    if (flags.includes("sms")) fd.set("sms_opt_in", "true");
    startTransition(async () => {
      const r = await addContact(accountId, fd);
      if (r.ok) {
        toast.success("Contact added");
        setName("");
        setEmail("");
        setPhone("");
        setFlags([]);
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
            {canEdit ? (
              <CardContent>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(c.id)}>
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              </CardContent>
            ) : null}
          </Card>
        ))}
        {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts yet.</p> : null}
      </div>
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add contact</CardTitle>
            <CardDescription>Site contact, billing contact, or decision maker.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="contact-name">Name</FieldLabel>
                <Input id="contact-name" aria-describedby="contact-name-hint" value={name} autoComplete="name" className="max-md:h-12" onChange={(event) => setName(event.target.value)} />
                <FieldHint id="contact-name-hint">Who to ask for at this account.</FieldHint>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="contact-phone">Mobile</FieldLabel>
                  <Input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" aria-describedby="contact-phone-hint" value={phone} className="max-md:h-12" onChange={(event) => setPhone(event.target.value)} />
                  <FieldHint id="contact-phone-hint">A number for this person, separate from the account.</FieldHint>
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-email">Email</FieldLabel>
                  <Input id="contact-email" type="email" inputMode="email" autoComplete="email" aria-describedby="contact-email-hint" value={email} className="max-md:h-12" onChange={(event) => setEmail(event.target.value)} />
                  <FieldHint id="contact-email-hint">Where to write this person.</FieldHint>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="contact-role">Role</FieldLabel>
                <NativeSelect id="contact-role" aria-describedby="contact-role-hint" value={role} className="max-md:h-12" onChange={(event) => setRole(event.target.value)}>
                  <option value="site">Site contact</option>
                  <option value="decision_maker">Decision maker</option>
                  <option value="other">Other</option>
                </NativeSelect>
                <FieldHint id="contact-role-hint">Whether they run the site or approve the work.</FieldHint>
              </Field>
              <div className="flex min-w-0 flex-col gap-1">
              <ToggleGroup aria-label="Contact flags" spacing={0} multiple variant="outline" value={flags} onValueChange={setFlags}>
                <ToggleGroupItem value="primary" aria-label="Primary" className="max-md:h-11">Primary</ToggleGroupItem>
                <ToggleGroupItem value="billing" aria-label="Billing" className="max-md:h-11">Billing</ToggleGroupItem>
                <ToggleGroupItem value="sms" aria-label="SMS" className="max-md:h-11">SMS</ToggleGroupItem>
              </ToggleGroup>
              <FieldHint>Primary is the main person, billing gets invoices, and text can receive messages.</FieldHint>
              </div>
              <Button type="submit" disabled={pending} className="min-h-11 lg:min-h-9">
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Add contact
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
