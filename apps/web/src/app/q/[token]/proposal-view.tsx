"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { defaultSelectedIds, sumSelected } from "@/lib/quotes/selection";
import { AcceptForm } from "./accept-form";

type Item = {
  id: string;
  name: string;
  description: string | null;
  state: "included" | "recommended" | "optional";
  option_group: string | null;
  option_tier: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  photo_url: string | null;
  selected: boolean;
};

export function ProposalView({
  token,
  payload,
}: {
  token: string;
  payload: {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    expires_at: string | null;
    status: string;
    org: { name: string; phone: string | null; email: string | null; brand_color: string | null };
    items: Item[];
  };
}) {
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

  const total = useMemo(() => sumSelected(payload.items, selectedIds, "price"), [payload.items, selectedIds]);

  const brand = payload.org.brand_color ?? "#166534";

  return (
    <main className="mx-auto min-h-svh max-w-xl px-4 py-10 [padding-inline-start:max(1rem,env(safe-area-inset-left,0px))] [padding-inline-end:max(1rem,env(safe-area-inset-right,0px))]">
      <p className="text-sm font-medium" style={{ color: brand }}>
        {payload.org.name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{payload.title}</h1>
      <p className="text-sm text-muted-foreground">Quote #{payload.number}</p>
      {payload.intro ? <p className="mt-4 text-sm leading-relaxed">{payload.intro}</p> : null}

      <div className="mt-6 flex flex-col gap-4">
        {groups.map((g) => {
          const options = payload.items.filter((i) => i.option_group === g);
          return (
            <section key={g} className="rounded-xl border p-4">
              <h2 className="font-medium">{g}</h2>
              <div className="mt-3 grid gap-2">
                {options.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-foreground">
                    <input
                      type="radio"
                      name={g}
                      checked={picked[g] === o.id}
                      onChange={() => setPicked((p) => ({ ...p, [g]: o.id }))}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="min-w-0 font-medium capitalize [overflow-wrap:anywhere]">
                          {o.option_tier === "none" ? o.name : o.option_tier}
                        </span>
                        <span className="shrink-0 tabular-nums">${Number(o.price).toFixed(0)}</span>
                      </div>
                      {o.description ? <p className="text-xs text-muted-foreground">{o.description}</p> : null}
                    </div>
                  </label>
                ))}
              </div>
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
                <input type="checkbox" checked={!!extras[i.id]} onChange={(e) => setExtras((x) => ({ ...x, [i.id]: e.target.checked }))} className="mt-1" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{i.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {i.range_low != null ? `$${Number(i.range_low).toFixed(0)}–$${Number(i.range_high).toFixed(0)}` : `$${Number(i.price).toFixed(0)}`}
                  </span>
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

      <div className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t bg-background py-4 [padding-block-end:calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <div className="text-xs text-muted-foreground">Live total</div>
          <div className="text-2xl font-semibold tabular-nums">${total.toFixed(2)}</div>
        </div>
        <Button render={<a href={`/q/${token}/pdf?selected=${selectedIds.join(",")}`} />}>Download PDF</Button>
      </div>
      <AcceptForm token={token} status={payload.status} selectedIds={selectedIds} />
      {payload.notes_customer ? <p className="mt-4 text-sm text-muted-foreground">{payload.notes_customer}</p> : null}
      <p className="mt-6 text-xs text-muted-foreground">
        {payload.org.phone} {payload.org.email ? `· ${payload.org.email}` : ""}
      </p>
    </main>
  );
}
