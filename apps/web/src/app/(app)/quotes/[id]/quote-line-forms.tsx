"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
      <Input name="section" aria-label="Section name" placeholder="Section name" autoFocus />
      <div className="flex gap-2">
        <Input name="name" aria-label="First line name" placeholder="First line" className="flex-1" />
        <Input name="price" aria-label="First line price" inputMode="decimal" placeholder="$ Price" className="w-28" />
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input name="name" aria-label="Line name" placeholder="Name" className="sm:flex-1" />
        <Input name="price" aria-label="Price" inputMode="decimal" placeholder="$ Price" className="sm:w-28" />
        <Button type="submit" disabled={pending}>Add</Button>
      </div>
      <details>
        <summary className="text-sm text-muted-foreground">More</summary>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Input name="description" aria-label="Description" placeholder="Description" className="sm:flex-1" />
          <select name="option_tier" aria-label="Good, better, or best" defaultValue="none" className="h-11 min-h-11 rounded-lg border bg-transparent px-2 text-sm md:h-8 md:min-h-0">
            <option value="none">No tier</option>
            <option value="good">Good</option>
            <option value="better">Better</option>
            <option value="best">Best</option>
          </select>
          <Input name="option_group" aria-label="Option group" placeholder="Option group" className="sm:w-36" />
          <Input name="photo_url" aria-label="Photo URL" placeholder="Photo URL" inputMode="url" className="sm:min-w-40 sm:flex-1" />
          <Input name="hours" aria-label="Hours" inputMode="decimal" placeholder="Hours" className="sm:w-24" />
          <Input name="cost" aria-label="Cost" inputMode="decimal" placeholder="Cost" className="sm:w-24" />
        </div>
      </details>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
