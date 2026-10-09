"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatMoney, formatMoneyRange } from "@/lib/money";
import { formatNotToExceedAmount, notToExceedClause } from "@/lib/quotes/legal-copy";
import { acceptanceTotals, lineHasRange } from "@/lib/quotes/not-to-exceed";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { defaultSelectedIds } from "@/lib/quotes/selection";
import { AcceptForm } from "./accept-form";
import { RecordView } from "./record-view";

type Item = PublicQuote["items"][number];

function linePrice(item: Item) {
  if (lineHasRange(item)) return formatMoneyRange(Number(item.range_low), Number(item.range_high));
  return formatMoney(Number(item.price));
}

export function ProposalView({ token, payload }: { token: string; payload: PublicQuote }) {
  const groups = [...new Set(payload.items.filter((i) => i.option_group).map((i) => i.option_group!))];
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const defaults = new Set(defaultSelectedIds(payload.items));
    const init: Record<string, string> = {};
    for (const item of payload.items) {
      if (item.option_group && defaults.has(item.id)) init[item.option_group] = item.id;
    }
    return init;
  });
  const [extras, setExtras] = useState<Record<string, boolean>>(() => {
    const defaults = new Set(defaultSelectedIds(payload.items));
    const init: Record<string, boolean> = {};
    for (const item of payload.items) {
      if (!item.option_group && item.state !== "included") init[item.id] = defaults.has(item.id);
    }
    return init;
  });

  const selectedIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of payload.items) {
      if (item.option_group) {
        if (picked[item.option_group] === item.id) ids.push(item.id);
      } else if (item.state === "included" || extras[item.id]) ids.push(item.id);
    }
    return ids;
  }, [payload.items, picked, extras]);

  const live = useMemo(() => acceptanceTotals(payload.items, selectedIds), [payload.items, selectedIds]);
  const stored = payload.status === "accepted" ? payload.acceptance : null;
  const hasRanges = stored?.has_ranges ?? live.hasRanges;
  const notToExceed = stored?.accepted_not_to_exceed ?? live.notToExceed;
  const estimate = stored?.accepted_total ?? live.acceptedTotal;
  const clause = hasRanges ? (stored?.not_to_exceed_clause ?? notToExceedClause(formatNotToExceedAmount(notToExceed))) : null;

  return (
    <main className="mx-auto min-h-svh max-w-xl px-4 py-10 [padding-inline-start:max(1rem,env(safe-area-inset-left,0px))] [padding-inline-end:max(1rem,env(safe-area-inset-right,0px))]">
      <RecordView token={token} status={payload.status} />
      <p className="text-sm font-medium text-primary">{payload.org.name}</p>
      <h1 className="mt-1 text-3xl font-bold">{payload.title}</h1>
      <p className="text-sm text-muted-foreground">Quote #{payload.number}</p>
      {payload.intro ? <p className="mt-4 text-lg leading-7">{payload.intro}</p> : null}

      <div className="mt-6 flex flex-col gap-4">
        {groups.map((g) => {
          const options = payload.items.filter((i) => i.option_group === g);
          return (
            <section key={g} className="rounded-xl border p-4">
              <h2 className="font-medium">{g}</h2>
              <RadioGroup value={picked[g]} onValueChange={(id) => setPicked((p) => ({ ...p, [g]: id }))} className="mt-3 grid gap-2">
                {options.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-[checked]:border-primary"
                  >
                    <RadioGroupItem value={o.id} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="min-w-0 font-medium capitalize [overflow-wrap:anywhere]">
                          {o.option_tier === "none" ? o.name : o.option_tier}
                        </span>
                        <span className="shrink-0 font-heading tabular-nums">{linePrice(o)}</span>
                      </div>
                      {o.description ? <p className="text-xs text-muted-foreground">{o.description}</p> : null}
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </section>
          );
        })}

        {payload.items
          .filter((i) => !i.option_group)
          .map((i) => (
            <label key={i.id} className="flex items-start gap-3 rounded-xl border p-4">
              {i.state === "included" ? (
                <span className="mt-0.5 text-xs text-muted-foreground">Included</span>
              ) : (
                <Checkbox
                  checked={!!extras[i.id]}
                  onCheckedChange={(checked) => setExtras((x) => ({ ...x, [i.id]: checked }))}
                  className="mt-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{i.name}</span>
                  <span className="shrink-0 font-heading tabular-nums">{linePrice(i)}</span>
                </div>
                {i.description ? <p className="text-xs text-muted-foreground">{i.description}</p> : null}
                {i.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.photo_url}
                    alt=""
                    className="mt-2 w-full rounded-md bg-muted object-cover [aspect-ratio:16/9] [block-size:auto]"
                  />
                ) : null}
              </div>
            </label>
          ))}
      </div>

      {clause ? <p className="mt-6 text-sm">{clause}</p> : null}
      <div className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t bg-background py-4 [padding-block-end:calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <div className="text-xs text-muted-foreground">{hasRanges ? "Not to exceed" : "Total"}</div>
          <div className="font-heading text-2xl font-bold tabular-nums">
            {formatMoney(hasRanges ? notToExceed : estimate, { cents: true })}
          </div>
          {hasRanges ? (
            <div className="text-xs text-muted-foreground">Estimate {formatMoney(estimate, { cents: true })}</div>
          ) : null}
        </div>
        <Button size="lg" render={<a href={`/q/${token}/pdf?selected=${selectedIds.join(",")}`} />}>
          Download PDF
        </Button>
      </div>
      <AcceptForm token={token} status={payload.status} selectedIds={selectedIds} clause={clause} />
      {payload.notes_customer ? <p className="mt-4 text-sm text-muted-foreground">{payload.notes_customer}</p> : null}
      <p className="mt-6 text-xs text-muted-foreground">
        {payload.org.phone} {payload.org.email ? `· ${payload.org.email}` : ""}
      </p>
      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <Image src="/brand/lq-mark-16.svg" alt="" width={16} height={16} unoptimized className="size-4" />
        Powered by LawnQuoter
      </p>
    </main>
  );
}
