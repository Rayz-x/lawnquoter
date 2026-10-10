"use client";

import { useState, useTransition } from "react";
import type { PricedLine } from "@lawnquoter/pricing-engine";
import { TabBox } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import { addLineItem, addPricedService } from "../actions";

type Line = { id: string; name: string; state: string; option_group: string | null; option_tier: string; price: number; inTotal: boolean };
const pricePattern = /^\d+(\.\d{1,2})?$/;

export function QuoteLines({
  quoteId,
  versionId,
  lines,
  rules,
  basis,
  editable,
}: {
  quoteId: string;
  versionId: string | null;
  lines: Line[];
  rules: { id: string; name: string; priced: PricedLine }[];
  basis: string;
  editable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<string | null>(null);
  const matches = rules.filter((rule) => rule.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  const groups = new Map<string, Line[]>();
  const loose: Line[] = [];
  for (const line of lines) {
    if (line.option_group) groups.set(line.option_group, [...(groups.get(line.option_group) ?? []), line]);
    else loose.push(line);
  }
  const sections = [...groups.entries()].map(([id, rows]) => ({ id, label: id, rows }));
  if (loose.length > 0 || sections.length === 0) sections.push({ id: "lines", label: sections.length ? "Add-ons" : "Lines", rows: loose });
  const value = sections.some((section) => section.id === tab) ? (tab ?? "lines") : (sections[0]?.id ?? "lines");

  function addRule(rule: (typeof rules)[number]) {
    if (!versionId) return;
    const fd = new FormData();
    fd.set("name", rule.name);
    fd.set("price", String(rule.priced.price));
    fd.set("hours", String(rule.priced.hours));
    fd.set("cost", String(rule.priced.cost));
    if (rule.priced.range) {
      fd.set("range_low", String(rule.priced.range.low));
      fd.set("range_high", String(rule.priced.range.high));
    }
    fd.set("state", "included");
    startTransition(async () => {
      const result = await addPricedService(quoteId, versionId, fd);
      if (!result.ok) return setError(result.error);
      setQuery("");
      setOpen(false);
      setError(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {editable && versionId ? (
        <div className="flex flex-col gap-1.5" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
          <label className="text-sm font-medium" htmlFor="catalog-search">Add from catalog</label>
          <Input id="catalog-search" role="combobox" aria-expanded={open} aria-controls="catalog-results" aria-autocomplete="list" autoFocus={lines.length === 0} placeholder="Search the catalog…" value={query} disabled={pending} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) { event.preventDefault(); addRule(matches[0]); } if (event.key === "Escape") setOpen(false); }} />
          <p className="text-xs text-muted-foreground">{basis}</p>
          {open ? (
            <ul id="catalog-results" role="listbox" className="max-h-64 overflow-auto rounded-lg border bg-card">
              {matches.map((rule) => (
                <li key={rule.id}>
                  <button type="button" role="option" aria-selected={false} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={(event) => { event.preventDefault(); addRule(rule); }}>
                    <span className="font-medium">{rule.name}</span>
                    <span className="font-heading tabular-nums">{formatMoney(rule.priced.price)}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">{rules.length === 0 ? "Add pricing rules under Settings." : "No matching service."}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <TabBox
        label="Line sections"
        value={value}
        onValueChange={setTab}
        tabs={sections.map((section) => ({
          value: section.id,
          label: section.label,
          count: section.rows.length,
          content: section.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this section.</p> : section.rows.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-0">
              <div className="min-w-0">
                <div className="font-medium">{line.name}</div>
                <div className="text-xs capitalize text-muted-foreground">{line.state}{line.option_tier !== "none" ? ` · ${line.option_tier}` : ""}{line.inTotal ? "" : " · not in total"}</div>
              </div>
              <div className="font-heading tabular-nums">{formatMoney(line.price)}</div>
            </div>
          )),
        }))}
      />
      {editable && versionId ? (
        <form noValidate className="flex flex-col gap-2" onSubmit={(event) => {
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
          if (value !== "lines") fd.set("option_group", value);
          startTransition(async () => {
            const result = await addLineItem(quoteId, versionId, fd);
            if (result.ok) { setError(null); form.reset(); } else setError(result.error);
          });
        }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input name="name" aria-label="Line name" placeholder="Custom line" className="sm:flex-1" />
            <Input name="price" aria-label="Price" inputMode="decimal" placeholder="$ Price" className="sm:w-32" />
            <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Add</Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
