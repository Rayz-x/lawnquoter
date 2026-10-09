import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLine, defaultModifiers, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AddItemForm } from "./add-item-form";
import { PriceFromCatalog } from "./price-from-catalog";
import { QuoteMetaForm } from "./quote-meta-form";
import { SendQuoteButton } from "./send-quote-button";

export const metadata: Metadata = { title: "Quote" };

export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("*, accounts(name), properties(formatted_address, lot_sqft, slope, gate_width_in, obstacle_count, has_stairs)")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .single();
  if (!quote) notFound();

  const { data: versionId } = await supabase.rpc("quote_current_version", { p_quote: id });
  const [{ data: items }, { data: rules }, { data: list }, { data: measurement }] = await Promise.all([
    versionId
      ? supabase.from("quote_line_items").select("*").eq("version_id", versionId).order("sort")
      : Promise.resolve({ data: [] }),
    supabase.from("pricing_rules").select("id, name, rule_type, config, service_id").eq("org_id", session.orgId).eq("active", true),
    supabase.from("price_lists").select("modifiers").eq("org_id", session.orgId).eq("status", "active").maybeSingle(),
    quote.property_id
      ? supabase
          .from("measurements")
          .select("confidence, measurement_features(category, area_sqft, length_ft)")
          .eq("property_id", quote.property_id)
          .eq("status", "current")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const modifiers = (list?.modifiers as Modifiers | null) ?? defaultModifiers();
  const quantities: Record<string, number> = {};
  for (const f of measurement?.measurement_features ?? []) {
    if (f.category === "turf_front") quantities.turf_front_sqft = Number(f.area_sqft ?? 0);
    else if (f.category === "turf_back") quantities.turf_back_sqft = Number(f.area_sqft ?? 0);
    else if (f.category === "edging_line") quantities.edging_lf = Number(f.length_ft ?? 0);
    else if (f.area_sqft) quantities[`${f.category}_sqft`] = Number(f.area_sqft);
  }
  if (!quantities.turf_sqft && quote.properties?.lot_sqft) quantities.lot_sqft = Number(quote.properties.lot_sqft);

  const included = (items ?? []).filter((i) => i.state === "included" || i.selected);
  const total = included.reduce((s, i) => s + Number(i.price), 0);
  const hours = included.reduce((s, i) => s + Number(i.hours), 0);
  const cost = included.reduce((s, i) => s + Number(i.cost), 0);

  return (
    <>
      <PageHeader
        title={`Quote #${quote.number} · ${quote.title}`}
        description={`${quote.accounts?.name ?? ""}${quote.properties?.formatted_address ? ` · ${quote.properties.formatted_address}` : ""}`}
        actions={
          <>
            <SendQuoteButton quoteId={quote.id} token={quote.public_token} status={quote.status} />
            {quote.status !== "draft" ? (
              <Button variant="outline" render={<Link href={`/q/${quote.public_token}`} target="_blank" />}>
                View proposal
              </Button>
            ) : null}
          </>
        }
      />
      <div className="page-pad grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Line items
                <span className="text-sm font-normal text-muted-foreground">
                  v{quote.current_version} · <Badge variant="outline">{quote.status}</Badge>
                </span>
              </CardTitle>
              <CardDescription>Included / recommended / optional. Group Good / Better / Best with the same option group name.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(items ?? []).map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
                  <div>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.state}
                      {i.option_group ? ` · ${i.option_group} / ${i.option_tier}` : ""}
                      {i.range_low != null ? ` · range $${Number(i.range_low).toFixed(0)}–$${Number(i.range_high).toFixed(0)}` : ""}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    ${Number(i.price).toFixed(2)}
                    <div className="text-xs text-muted-foreground">
                      {Number(i.hours).toFixed(2)}h · ${Number(i.cost).toFixed(2)} cost
                    </div>
                  </div>
                </div>
              ))}
              {(items ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Add a line or price from the catalog.</p> : null}
            </CardContent>
          </Card>
          {versionId ? <AddItemForm quoteId={quote.id} versionId={versionId} /> : null}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              <div className="flex justify-between">
                <span>Price</span>
                <span className="font-medium">${total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Hours</span>
                <span>{hours.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Cost</span>
                <span>${cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Margin</span>
                <span>{total > 0 ? `${Math.round(((total - cost) / total) * 100)}%` : "—"}</span>
              </div>
            </CardContent>
          </Card>
          <QuoteMetaForm quote={quote} />
          {versionId ? (
            <PriceFromCatalog
              quoteId={quote.id}
              versionId={versionId}
              rules={(rules ?? []).map((r) => {
                const priced = priceLine({
                  rule: r.config as PricingRule,
                  quantities,
                  context: {
                    slope: quote.properties?.slope ?? undefined,
                    gateWidthIn: quote.properties?.gate_width_in,
                    obstacleCount: quote.properties?.obstacle_count,
                    hasStairs: quote.properties?.has_stairs,
                    confidence: measurement?.confidence != null ? Number(measurement.confidence) : undefined,
                  },
                  modifiers,
                });
                return { id: r.id, name: r.name, priced };
              })}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
