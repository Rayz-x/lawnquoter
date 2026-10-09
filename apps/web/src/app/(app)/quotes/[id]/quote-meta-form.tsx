"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { updateQuoteMeta } from "../actions";

export function QuoteMetaForm({
  quote,
}: {
  quote: { id: string; title: string; intro: string | null; notes_customer: string | null; notes_internal: string | null };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal copy</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = await updateQuoteMeta(quote.id, fd);
              if (r.ok) toast.success("Saved");
              else toast.error(r.error);
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor="q_title">Title</FieldLabel>
            <Input id="q_title" name="title" defaultValue={quote.title} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="q_intro">Customer intro</FieldLabel>
            <Textarea id="q_intro" name="intro" rows={3} defaultValue={quote.intro ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="q_notes">Customer notes</FieldLabel>
            <Textarea id="q_notes" name="notes_customer" rows={2} defaultValue={quote.notes_customer ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="q_internal">Internal notes</FieldLabel>
            <Textarea id="q_internal" name="notes_internal" rows={2} defaultValue={quote.notes_internal ?? ""} />
          </Field>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save copy
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
