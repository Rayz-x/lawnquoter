"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { PricedLine } from "@lawnquoter/pricing-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { addPricedService } from "../actions";

export function PriceFromCatalog({
  quoteId,
  versionId,
  rules,
  basis,
}: {
  quoteId: string;
  versionId: string;
  rules: { id: string; name: string; priced: PricedLine }[];
  basis: string;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const needle = query.trim().toLowerCase();
  const matches = (needle ? rules.filter((rule) => rule.name.toLowerCase().includes(needle)) : rules).slice(0, 6);

  function add(ruleId: string) {
    const fd = new FormData();
    fd.set("rule_id", ruleId);
    fd.set("state", "included");
    startTransition(async () => {
      const result = await addPricedService(quoteId, versionId, fd);
      if (result.ok) {
        setQuery("");
        toast.success("Added");
      } else toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>From catalog</CardTitle>
        <Input aria-label="Search the catalog" placeholder="Search catalog" value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} />
        <p className="text-xs text-muted-foreground">{basis}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {matches.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 font-medium">{rule.name}</span>
            <span className="font-heading tabular-nums">{formatMoney(rule.priced.price)}</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => add(rule.id)}>Add</Button>
          </div>
        ))}
        {matches.length === 0 ? <p className="text-sm text-muted-foreground">{rules.length === 0 ? "Add pricing rules under Settings." : "No matching service."}</p> : null}
      </CardContent>
    </Card>
  );
}
