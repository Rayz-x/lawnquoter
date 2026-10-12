"use client";

import { useState, useTransition } from "react";
import { HelpTip } from "@/components/help/help-tip";
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
      <div className="flex min-w-0 flex-col gap-1">
        <Input name="section" aria-label="Section name" placeholder="Section name" autoFocus className="w-full" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="name" aria-label="First line name" placeholder="First line" className="w-full" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="price" aria-label="First line price" inputMode="decimal" placeholder="$ Price" className="w-full" />
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
          <Input name="name" aria-label="Line name" placeholder="Name" className="w-full" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Input name="price" aria-label="Price" inputMode="decimal" placeholder="$ Price" className="w-full" />
        </div>
        <Button type="submit" disabled={pending}>Add</Button>
      </div>
      <details>
        <summary className="text-sm text-muted-foreground">More</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="description" aria-label="Description" placeholder="Description" className="w-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              Good, better, or best
              <HelpTip
                label="Help for good, better, and best"
                text="Lines in the same option group are choices. The customer picks one."
                href="/help/quote-builder#good-better-and-best"
              />
            </span>
            <select name="option_tier" aria-label="Good, better, or best" defaultValue="none" className="h-11 min-h-11 w-full rounded-lg border bg-transparent px-2 text-sm md:h-8 md:min-h-0">
              <option value="none">No tier</option>
              <option value="good">Good</option>
              <option value="better">Better</option>
              <option value="best">Best</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="option_group" aria-label="Option group" placeholder="Option group" className="w-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="photo_url" aria-label="Photo URL" placeholder="Photo URL" inputMode="url" className="w-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="hours" aria-label="Hours" inputMode="decimal" placeholder="Hours" className="w-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Input name="cost" aria-label="Cost" inputMode="decimal" placeholder="Cost" className="w-full" />
          </div>
        </div>
      </details>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
