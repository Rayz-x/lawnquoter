"use client";

import { useState, useTransition } from "react";
import { GripVertical } from "lucide-react";
import type { PricedLine } from "@lawnquoter/pricing-engine";
import { toast } from "sonner";
import { SectionMenu } from "@/components/entry/section-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { hasSiteCheck, siteCheckReasonsSummary } from "@/lib/quotes/site-check";
import { addPricedService, deleteLineItem, flagLineNeedsSiteCheck, reorderLineItems, updateLineItem } from "../actions";
import { NewSectionForm, QuickAddForm } from "./quote-line-forms";

type Line = {
  id: string;
  name: string;
  description: string | null;
  state: string;
  section_id: string | null;
  option_tier: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  site_check_reasons: string[];
};

export function QuoteLines({
  quoteId,
  versionId,
  lines,
  sections,
  rules,
  basis,
  editable,
}: {
  quoteId: string;
  versionId: string | null;
  lines: Line[];
  sections: { id: string; title: string }[];
  rules: { id: string; name: string; priced: PricedLine }[];
  basis: string;
  editable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const known = new Set(sections.map((section) => section.id));
  const loose = lines.filter((line) => !line.section_id || !known.has(line.section_id));
  const tabs = [
    ...sections.map((section) => ({ id: section.id, label: section.title, rows: lines.filter((line) => line.section_id === section.id) })),
    { id: "lines", label: sections.length ? "Add-ons" : "Lines", rows: loose },
  ];
  const value = tabs.some((section) => section.id === tab) ? (tab ?? "lines") : (tabs[0]?.id ?? "lines");
  const current = tabs.find((section) => section.id === value) ?? tabs[0];
  const matches = rules.filter((rule) => rule.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);

  function addRule(ruleId: string) {
    if (!versionId) return;
    const fd = new FormData();
    fd.set("rule_id", ruleId);
    fd.set("state", "included");
    if (value !== "lines") fd.set("section_id", value);
    startTransition(async () => {
      const result = await addPricedService(quoteId, versionId, fd);
      if (!result.ok) return setError(result.error);
      setQuery("");
      setError(null);
    });
  }

  function reorder(targetId: string, sourceId: string) {
    if (!sourceId || sourceId === targetId) return;
    startTransition(async () => {
      const result = await reorderLineItems(quoteId, sourceId, targetId);
      if (!result.ok) setError(result.error);
    });
  }

  function toggleSiteCheck(line: Line) {
    const enabled = !line.site_check_reasons.includes("manual");
    const note = enabled ? window.prompt("Optional note for Needs site check", "") : "";
    if (enabled && note === null) return;
    const fd = new FormData();
    fd.set("enabled", enabled ? "true" : "false");
    if (note) fd.set("note", note);
    startTransition(async () => {
      const result = await flagLineNeedsSiteCheck(quoteId, line.id, fd);
      if (!result.ok) {
        toast.error(result.error);
        setError(result.error);
        return;
      }
      toast.success(enabled ? "Marked Needs site check" : "Cleared Needs site check");
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Quote lines">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search the catalog" placeholder="Search catalog" value={query} disabled={!editable || pending} className="min-w-0 flex-1" onChange={(event) => setQuery(event.target.value)} />
        <span className="text-xs text-muted-foreground">{basis}</span>
        {editable ? <Button type="button" variant="outline" onClick={() => setNaming(true)}>Add section</Button> : null}
      </div>
      {naming && editable && versionId ? <NewSectionForm quoteId={quoteId} versionId={versionId} onCreated={(sectionId) => { setTab(sectionId); setNaming(false); }} /> : null}
      {query.trim() ? (
        <ul className="flex flex-col gap-1">
          {matches.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 font-medium">{rule.name}</span>
              <span className="font-heading tabular-nums">{formatMoney(rule.priced.price)}</span>
              <Button type="button" size="sm" disabled={!editable || !versionId || pending} onClick={() => addRule(rule.id)}>Add</Button>
            </li>
          ))}
          {matches.length === 0 ? <li className="text-sm text-muted-foreground">{rules.length === 0 ? "Add pricing rules under Settings." : "No matching service."}</li> : null}
        </ul>
      ) : null}
      <div role="tablist" aria-label="Line sections" className="flex gap-2 overflow-x-auto">
        {tabs.map((section) => (
          <button key={section.id} type="button" role="tab" aria-selected={section.id === value} className="min-h-11 shrink-0 rounded-full border px-3 text-sm data-[on=true]:bg-muted" data-on={section.id === value} onClick={() => setTab(section.id)}>
            {section.label} {section.rows.length}
          </button>
        ))}
      </div>
      {current?.rows.map((line, index) => {
        const flagged = hasSiteCheck(line.site_check_reasons);
        const ranged = line.range_low != null && line.range_high != null;
        return (
          <div
            key={line.id}
            className={
              flagged
                ? "rounded-md bg-warning/[0.06] px-2 py-2 text-sm md:flex md:items-center md:gap-2"
                : "border-b py-2 text-sm last:border-0 md:flex md:items-center md:gap-2"
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); reorder(line.id, event.dataTransfer.getData("text/plain")); }}
          >
            <div className="flex items-center gap-2 md:contents">
              <span aria-hidden="true" draggable={editable} className="shrink-0 cursor-grab text-muted-foreground" onDragStart={(event) => event.dataTransfer.setData("text/plain", line.id)}>
                <GripVertical className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{line.name}</span>
                  {flagged ? (
                    <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                      Site check
                    </Badge>
                  ) : null}
                </div>
                {line.description ? <div className="text-xs text-muted-foreground">{line.description}</div> : null}
                {flagged ? <div className="text-xs text-warning">{siteCheckReasonsSummary(line.site_check_reasons)}</div> : null}
              </div>
              <div className="text-right font-heading tabular-nums">
                {ranged ? (
                  <>
                    <div>{formatMoney(line.range_low!)} – {formatMoney(line.range_high!)}</div>
                    <div className="text-xs text-muted-foreground">est. {formatMoney(line.price)}</div>
                  </>
                ) : (
                  formatMoney(line.price)
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 md:mt-0">
              {line.option_tier !== "none" ? <Badge variant="secondary" className="capitalize">{line.option_tier}</Badge> : null}
              <select aria-label={`State for ${line.name}`} className="h-11 min-h-11 rounded-lg border bg-transparent px-2 text-sm capitalize md:h-8 md:min-h-0" value={line.state} disabled={!editable || pending} onChange={(event) => startTransition(async () => { const fd = new FormData(); fd.set("state", event.target.value); const result = await updateLineItem(quoteId, line.id, fd); if (!result.ok) setError(result.error); })}>
                <option value="included">Included</option>
                <option value="recommended">Recommended</option>
                <option value="optional">Optional</option>
              </select>
              {index > 0 ? <Button type="button" variant="ghost" disabled={!editable || pending} onClick={() => reorder(current.rows[index - 1]!.id, line.id)}>Move up</Button> : null}
              {index < current.rows.length - 1 ? <Button type="button" variant="ghost" disabled={!editable || pending} onClick={() => reorder(current.rows[index + 1]!.id, line.id)}>Move down</Button> : null}
              {editable ? (
                <SectionMenu
                  label={`Actions for ${line.name}`}
                  items={[
                    {
                      id: "site-check",
                      label: line.site_check_reasons.includes("manual") ? "Clear Needs site check" : "Needs site check",
                      onSelect: () => toggleSiteCheck(line),
                    },
                  ]}
                />
              ) : null}
              <Button type="button" variant="ghost" disabled={!editable || pending} onClick={() => startTransition(async () => { const result = await deleteLineItem(quoteId, line.id); if (!result.ok) setError(result.error); })}>Remove</Button>
            </div>
          </div>
        );
      })}
      {current && current.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this section.</p> : null}
      {editable && versionId ? <QuickAddForm quoteId={quoteId} versionId={versionId} sectionId={value === "lines" ? null : value} /> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
