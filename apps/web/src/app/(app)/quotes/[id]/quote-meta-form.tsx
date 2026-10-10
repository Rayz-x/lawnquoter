"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { updateQuoteMeta } from "../actions";

type QuoteCopy = { id: string; title: string; intro: string | null; notes_customer: string | null; notes_internal: string | null };

function SaveStatus({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (saved) return <p className="text-xs text-success" role="status">Saved</p>;
  return null;
}

function useCardSave(quoteId: string) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function save(fd: FormData) {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateQuoteMeta(quoteId, fd);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }
  return { pending, saved, error, save };
}

export function ProposalCard({ quote, editable }: { quote: QuoteCopy; editable: boolean }) {
  const { pending, saved, error, save } = useCardSave(quote.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal text</CardTitle>
        {editable ? null : <CardDescription>Title, intro, and customer notes are locked. Revise the proposal to change them.</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData(event.currentTarget);
            fd.delete("notes_internal");
            save(fd);
          }}
        >
          <Field>
            <FieldLabel htmlFor="q_title">Title</FieldLabel>
            <Input id="q_title" name="title" defaultValue={quote.title} required={editable} disabled={!editable || pending} />
          </Field>
          <Field>
            <FieldLabel htmlFor="q_intro">Customer intro</FieldLabel>
            <Textarea id="q_intro" name="intro" rows={3} defaultValue={quote.intro ?? ""} disabled={!editable || pending} />
          </Field>
          <Field>
            <FieldLabel htmlFor="q_notes">Customer notes</FieldLabel>
            <Textarea id="q_notes" name="notes_customer" rows={2} defaultValue={quote.notes_customer ?? ""} disabled={!editable || pending} />
          </Field>
          <SaveStatus saved={saved} error={error} />
          {editable ? (
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save copy
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function InternalCard({ quote }: { quote: QuoteCopy }) {
  const { pending, saved, error, save } = useCardSave(quote.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData();
            fd.set("notes_internal", String(new FormData(event.currentTarget).get("notes_internal") ?? ""));
            save(fd);
          }}
        >
          <Field>
            <FieldLabel htmlFor="q_internal">Internal notes</FieldLabel>
            <Textarea id="q_internal" name="notes_internal" rows={2} defaultValue={quote.notes_internal ?? ""} disabled={pending} />
          </Field>
          <SaveStatus saved={saved} error={error} />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save internal notes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function QuoteMetaForm({ quote, editable }: { quote: QuoteCopy; editable: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ProposalCard quote={quote} editable={editable} />
      <InternalCard quote={quote} />
    </div>
  );
}
