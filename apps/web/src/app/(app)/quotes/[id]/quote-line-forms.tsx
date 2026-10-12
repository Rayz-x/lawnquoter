"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { addLineItem } from "../actions";

const pricePattern = /^\d+(\.\d{1,2})?$/;

export function NewSectionForm({
  quoteId,
  versionId,
  onCreated,
}: {
  quoteId: string;
  versionId: string;
  onCreated: (sectionId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        const section = String(fd.get("section") ?? "").trim();
        const name = String(fd.get("name") ?? "").trim();
        const price = String(fd.get("price") ?? "").trim();
        if (!section || !name || !pricePattern.test(price)) {
          setError(section && name ? "Enter a price of 0 or more, with up to 2 decimals." : "A section needs a name and a first line.");
          return;
        }
        fd.set("section_title", section);
        fd.set("name", name);
        fd.set("price", price);
        fd.set("state", "included");
        startTransition(async () => {
          const result = await addLineItem(quoteId, versionId, fd);
          if (!result.ok || !result.data.sectionId) {
            setError(result.ok ? "Section not found" : result.error);
            return;
          }
          setError(null);
          form.reset();
          onCreated(result.data.sectionId);
        });
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Input name="section" aria-label="Section name" aria-describedby="section-name-hint" placeholder="Section name" autoFocus className="w-full" />
        <FieldHint id="section-name-hint">The heading that groups these lines on the quote.</FieldHint>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="name" aria-label="First line name" aria-describedby="first-line-name-hint" placeholder="First line" className="w-full" />
          <FieldHint id="first-line-name-hint">The first service the customer sees in this section.</FieldHint>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="price" aria-label="First line price" aria-describedby="first-line-price-hint" inputMode="decimal" placeholder="$ Price" className="w-full" />
          <FieldHint id="first-line-price-hint">What the customer pays for that first line.</FieldHint>
        </div>
        <Button type="submit" disabled={pending}>Add</Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

export function QuickAddForm({
  quoteId,
  versionId,
  sectionId,
}: {
  quoteId: string;
  versionId: string;
  sectionId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        const name = String(fd.get("name") ?? "").trim();
        const price = String(fd.get("price") ?? "").trim();
        if (!name) return setError("A line name is required.");
        if (!pricePattern.test(price)) return setError("Enter a price of 0 or more, with up to 2 decimals.");
        fd.set("name", name);
        fd.set("price", price);
        fd.set("state", "included");
        if (sectionId) fd.set("section_id", sectionId);
        startTransition(async () => {
          const result = await addLineItem(quoteId, versionId, fd);
          if (!result.ok) return setError(result.error);
          setError(null);
          form.reset();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="name" aria-label="Line name" aria-describedby={`line-name-${sectionId ?? "open"}-hint`} placeholder="Name" className="w-full" />
          <FieldHint id={`line-name-${sectionId ?? "open"}-hint`}>The service name the customer sees on the quote.</FieldHint>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="price" aria-label="Price" aria-describedby={`line-price-${sectionId ?? "open"}-hint`} inputMode="decimal" placeholder="$ Price" className="w-full" />
          <FieldHint id={`line-price-${sectionId ?? "open"}-hint`}>What the customer pays for this line.</FieldHint>
        </div>
        <Button type="submit" disabled={pending}>Add</Button>
      </div>
      <details>
        <summary className="text-sm text-muted-foreground">More</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="description" aria-label="Description" aria-describedby={`line-desc-${sectionId ?? "open"}-hint`} placeholder="Description" className="w-full" />
            <FieldHint id={`line-desc-${sectionId ?? "open"}-hint`}>The sentence under this line on the quote.</FieldHint>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <select name="option_tier" aria-label="Good, better, or best" aria-describedby={`line-tier-${sectionId ?? "open"}-hint`} defaultValue="none" className="h-11 min-h-11 w-full rounded-lg border bg-transparent px-2 text-sm md:h-8 md:min-h-0">
              <option value="none">No tier</option>
              <option value="good">Good</option>
              <option value="better">Better</option>
              <option value="best">Best</option>
            </select>
            <FieldHint id={`line-tier-${sectionId ?? "open"}-hint`}>Marks this line as a good, better, or best choice.</FieldHint>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="option_group" aria-label="Option group" aria-describedby={`line-group-${sectionId ?? "open"}-hint`} placeholder="Option group" className="w-full" />
            <FieldHint id={`line-group-${sectionId ?? "open"}-hint`}>Groups choices so the customer picks one.</FieldHint>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="photo_url" aria-label="Photo URL" aria-describedby={`line-photo-${sectionId ?? "open"}-hint`} placeholder="Photo URL" inputMode="url" className="w-full" />
            <FieldHint id={`line-photo-${sectionId ?? "open"}-hint`}>A picture shown with this line on the quote.</FieldHint>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="hours" aria-label="Hours" aria-describedby={`line-hours-${sectionId ?? "open"}-hint`} inputMode="decimal" placeholder="Hours" className="w-full" />
            <FieldHint id={`line-hours-${sectionId ?? "open"}-hint`}>Crew hours for this line, which the customer does not see.</FieldHint>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="cost" aria-label="Cost" aria-describedby={`line-cost-${sectionId ?? "open"}-hint`} inputMode="decimal" placeholder="Cost" className="w-full" />
            <FieldHint id={`line-cost-${sectionId ?? "open"}-hint`}>Your cost for this line, which the customer does not see.</FieldHint>
          </div>
        </div>
      </details>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
