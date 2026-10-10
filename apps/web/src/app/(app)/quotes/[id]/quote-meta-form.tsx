"use client";

import { useState } from "react";
import { SectionCard, SectionMenu, useSectionAutosave } from "@/components/entry";
import { Textarea } from "@/components/ui/textarea";
import { updateQuoteMeta } from "../actions";

type QuoteCopy = {
  id: string;
  title: string;
  intro: string | null;
  notes_customer: string | null;
  notes_internal: string | null;
};

function saveCopy(
  quote: QuoteCopy,
  patch: { intro?: string; notes_customer?: string; notes_internal?: string },
  editable: boolean,
) {
  const fd = new FormData();
  if (editable) {
    fd.set("title", quote.title);
    fd.set("intro", patch.intro ?? quote.intro ?? "");
    fd.set("notes_customer", patch.notes_customer ?? quote.notes_customer ?? "");
  }
  fd.set("notes_internal", patch.notes_internal ?? quote.notes_internal ?? "");
  return updateQuoteMeta(quote.id, fd);
}

export function ProposalCard({ quote, editable }: { quote: QuoteCopy; editable: boolean }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [intro, setIntro] = useState(quote.intro ?? "");
  const [notes, setNotes] = useState(quote.notes_customer ?? "");
  const autosave = useSectionAutosave({
    initial: { intro: quote.intro ?? "", notes: quote.notes_customer ?? "" },
    onRollback: (values: { intro: string; notes: string }) => {
      setIntro(values.intro);
      setNotes(values.notes);
    },
    action: (values: { intro: string; notes: string }) =>
      saveCopy(quote, { intro: values.intro, notes_customer: values.notes, notes_internal: quote.notes_internal ?? "" }, true),
  });

  return (
    <SectionCard
      title="Proposal text"
      description="Shown to the customer."
      heading="h3"
      status={autosave.status}
      error={autosave.error}
      onRetry={autosave.retry}
      mode={editable ? mode : "view"}
      onEdit={editable ? () => setMode("edit") : undefined}
      menu={editable ? <SectionMenu label="Proposal actions" items={[{ id: "edit", label: "Edit", onSelect: () => setMode("edit") }]} /> : undefined}
      facts={[
        { label: "Intro", value: intro.trim() || "No customer intro yet." },
        { label: "Customer notes", value: notes.trim() || "No customer notes." },
      ]}
    >
      <div className="flex flex-col gap-3" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMode("view"); }}>
        <Textarea aria-label="Customer intro" rows={3} value={intro} autoFocus onChange={(event) => setIntro(event.target.value)} onBlur={(event) => autosave.save({ intro: event.target.value })} />
        <Textarea aria-label="Customer notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={(event) => autosave.save({ notes: event.target.value })} />
      </div>
    </SectionCard>
  );
}

export function InternalCard({ quote, editable }: { quote: QuoteCopy; editable: boolean }) {
  const [notes, setNotes] = useState(quote.notes_internal ?? "");
  const autosave = useSectionAutosave({
    initial: quote.notes_internal ?? "",
    onRollback: setNotes,
    action: (value: string) => saveCopy(quote, { notes_internal: value }, editable),
  });

  return (
    <SectionCard title="Internal notes" description="Only your office can see this." heading="h3" status={autosave.status} error={autosave.error} onRetry={autosave.retry}>
      <Textarea aria-label="Internal notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={(event) => autosave.save(event.target.value)} />
    </SectionCard>
  );
}
