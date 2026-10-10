"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LEAD_SOURCES } from "@/lib/leads/lead-source";
import { createManualLead } from "./actions";

export function ManualLeadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setSource("");
        }
      }}
    >
      <DialogTrigger render={<Button type="button" />}>
        <Plus className="size-4" />
        Add phone lead
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add phone lead</DialogTitle>
          <DialogDescription>Log a call-in lead. Newest leads show at the top of the inbox.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await createManualLead(fd);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setOpen(false);
              setSource("");
              router.refresh();
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor="contact_name">Name</FieldLabel>
            <Input id="contact_name" name="contact_name" autoComplete="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="contact_phone">Phone</FieldLabel>
            <Input id="contact_phone" name="contact_phone" type="tel" autoComplete="tel" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="contact_email">Email</FieldLabel>
            <Input id="contact_email" name="contact_email" type="email" autoComplete="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="address_typed">Address</FieldLabel>
            <Input
              id="address_typed"
              name="address_typed"
              autoComplete="street-address"
              placeholder="Optional — defaults if blank"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead_source">Source</FieldLabel>
            <NativeSelect
              id="lead_source"
              name="lead_source"
              required
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">Choose source</option>
              {LEAD_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {source === "Other" ? (
            <Field>
              <FieldLabel htmlFor="lead_source_other">Source details</FieldLabel>
              <Input id="lead_source_other" name="lead_source_other" maxLength={100} required />
            </Field>
          ) : (
            <input type="hidden" name="lead_source_other" value="" />
          )}
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
