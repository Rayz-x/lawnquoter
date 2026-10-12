"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSectionAutosave } from "@/components/entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateQuoteMeta } from "../actions";

type QuoteCopy = { id: string; title: string; intro: string | null; notes_customer: string | null; notes_internal: string | null };

type ProposalDraft = { title: string; intro: string; notes_customer: string };
type NotesDraft = { notes_internal: string };

function SaveStatus({ status, error }: { status: string; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (status === "saving") return <p className="text-xs text-muted-foreground" role="status">Saving…</p>;
  if (status === "saved") return <p className="text-xs text-success" role="status">Saved ✓</p>;
  return null;
}

export function ProposalCard({ quote, editable }: { quote: QuoteCopy; editable: boolean }) {
  const router = useRouter();
  const initial = useMemo<ProposalDraft>(
    () => ({
      title: quote.title,
      intro: quote.intro ?? "",
      notes_customer: quote.notes_customer ?? "",
    }),
    [quote.title, quote.intro, quote.notes_customer],
  );
  const [draft, setDraft] = useState(initial);
  const { status, error, save } = useSectionAutosave<ProposalDraft>({
    initial,
    action: async (values) => {
      if (!editable) return { ok: true as const };
      const fd = new FormData();
      fd.set("title", values.title);
      fd.set("intro", values.intro);
      fd.set("notes_customer", values.notes_customer);
      const result = await updateQuoteMeta(quote.id, fd);
      if (result.ok) router.refresh();
      return result;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal text</CardTitle>
        {editable ? null : <CardDescription>Title, intro, and customer notes are locked. Revise the proposal to change them.</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="q_title">Title</FieldLabel>
          <Input
            id="q_title"
            aria-describedby="q-title-hint"
            value={draft.title}
            required={editable}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onBlur={(event) => {
              const title = event.target.value;
              setDraft((current) => ({ ...current, title }));
              if (editable) save({ title, intro: draft.intro, notes_customer: draft.notes_customer });
            }}
          />
          <FieldHint id="q-title-hint">The heading the customer sees at the top of the quote.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="q_intro">Customer intro</FieldLabel>
          <Textarea
            id="q_intro"
            aria-describedby="q-intro-hint"
            className="w-full"
            rows={3}
            value={draft.intro}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, intro: event.target.value })}
            onBlur={(event) => {
              const intro = event.target.value;
              setDraft((current) => ({ ...current, intro }));
              if (editable) save({ title: draft.title, intro, notes_customer: draft.notes_customer });
            }}
          />
          <FieldHint id="q-intro-hint">The opening note the customer reads before the prices.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="q_notes">Customer notes</FieldLabel>
          <Textarea
            id="q_notes"
            aria-describedby="q-notes-hint"
            className="w-full"
            rows={2}
            value={draft.notes_customer}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, notes_customer: event.target.value })}
            onBlur={(event) => {
              const notes_customer = event.target.value;
              setDraft((current) => ({ ...current, notes_customer }));
              if (editable) save({ title: draft.title, intro: draft.intro, notes_customer });
            }}
          />
          <FieldHint id="q-notes-hint">Extra notes the customer sees with the quote.</FieldHint>
        </Field>
        {editable ? <SaveStatus status={status} error={error} /> : null}
      </CardContent>
    </Card>
  );
}

export function InternalCard({ quote }: { quote: QuoteCopy }) {
  const router = useRouter();
  const initial = useMemo<NotesDraft>(() => ({ notes_internal: quote.notes_internal ?? "" }), [quote.notes_internal]);
  const [notes, setNotes] = useState(initial.notes_internal);
  const { status, error, save } = useSectionAutosave<NotesDraft>({
    initial,
    action: async (values) => {
      const fd = new FormData();
      fd.set("notes_internal", values.notes_internal);
      const result = await updateQuoteMeta(quote.id, fd);
      if (result.ok) router.refresh();
      return result;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="q_internal">Internal notes</FieldLabel>
          <Textarea
            id="q_internal"
            aria-describedby="q-internal-hint"
            className="w-full"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={(event) => {
              const notes_internal = event.target.value;
              setNotes(notes_internal);
              save({ notes_internal });
            }}
          />
          <FieldHint id="q-internal-hint">Office notes about this quote, which the customer does not see.</FieldHint>
        </Field>
        <SaveStatus status={status} error={error} />
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
