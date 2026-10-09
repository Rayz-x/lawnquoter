"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { PricedLine } from "@lawnquoter/pricing-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addPricedService } from "../actions";

export function PriceFromCatalog({
  quoteId,
  versionId,
  rules,
}: {
  quoteId: string;
  versionId: string;
  rules: { id: string; name: string; priced: PricedLine }[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>From catalog</CardTitle>
        <CardDescription>Priced against this property&apos;s measurement and modifiers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="tabular-nums text-xs text-muted-foreground">
                ${r.priced.price.toFixed(2)}
                {r.priced.range ? ` · $${r.priced.range.low.toFixed(0)}–$${r.priced.range.high.toFixed(0)}` : ""}
                {" · "}
                {r.priced.hours.toFixed(2)}h
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("name", r.name);
                  fd.set("price", String(r.priced.price));
                  fd.set("hours", String(r.priced.hours));
                  fd.set("cost", String(r.priced.cost));
                  if (r.priced.range) {
                    fd.set("range_low", String(r.priced.range.low));
                    fd.set("range_high", String(r.priced.range.high));
                  }
                  fd.set("state", "included");
                  const res = await addPricedService(quoteId, versionId, fd);
                  if (res.ok) toast.success("Added");
                  else toast.error(res.error);
                })
              }
            >
              Add
            </Button>
          </div>
        ))}
        {rules.length === 0 ? <p className="text-sm text-muted-foreground">Add pricing rules under Settings.</p> : null}
      </CardContent>
    </Card>
  );
}
