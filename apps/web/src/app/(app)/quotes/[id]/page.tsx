import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLine, defaultModifiers, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { QUOTE_CONVERT_ROLES } from "@/lib/auth/office-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { defaultSelectedIds, sumSelected } from "@/lib/quotes/selection";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";
import { ConvertToJobForm } from "./convert-to-job-button";
import { DeleteQuoteButton } from "./delete-quote-button";
import { QuoteLines } from "./price-from-catalog";
import { InternalCard, ProposalCard } from "./quote-meta-form";
import { SendQuoteButton } from "./send-quote-button";
import { ReviseQuoteButton } from "./revise-quote-button";

export const metadata: Metadata = { title: "Quote" };

export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "id, number, title, status, created_at, current_version, intro, notes_customer, notes_internal, public_token, property_id, accounts(name), properties(formatted_address, lot_sqft, slope, gate_width_in, obstacle_count, has_stairs)",
    )
    .eq("id", id)
    .eq("org_id", session.orgId)
    .single();
  if (!quote) notFound();

  const { data: convertedAgreement } = await supabase
    .from("agreements")
    .select("id")
    .eq("org_id", session.orgId)
    .eq("quote_id", id)
    .maybeSingle();
  const canConvert =
    quote.status === "accepted" && !convertedAgreement && hasRole(session.orgRole, QUOTE_CONVERT_ROLES);
  const { data: org } = canConvert
    ? await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle()
    : { data: null };

  const { data: versionId } = await supabase.rpc("quote_current_version", { p_quote: id });
  const [{ data: items }, { data: rules }, { data: list }, { data: measurement }] = await Promise.all([
    versionId
      ? supabase
          .from("quote_line_items")
          .select("id, name, state, option_group, option_tier, selected, price, hours, cost, range_low, range_high")
          .eq("version_id", versionId)
          .order("sort")
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            state: string;
            option_group: string | null;
            option_tier: string;
            selected: boolean;
            price: number;
            hours: number;
            cost: number;
            range_low: number | null;
            range_high: number | null;
          }[],
        }),
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

  const lines = items ?? [];

  const modifiers = (list?.modifiers as Modifiers | null) ?? defaultModifiers();
  const quantities: Record<string, number> = {};
  const addQty = (key: string, amount: number) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    quantities[key] = (quantities[key] ?? 0) + amount;
  };
  const quantityKey: Record<string, { key: string; field: "area_sqft" | "length_ft" }> = {
    turf_front: { key: "turf_front_sqft", field: "area_sqft" },
    turf_back: { key: "turf_back_sqft", field: "area_sqft" },
    bed: { key: "bed_sqft", field: "area_sqft" },
    hardscape: { key: "hardscape_sqft", field: "area_sqft" },
    driveway: { key: "driveway_sqft", field: "area_sqft" },
    sidewalk: { key: "sidewalk_sqft", field: "area_sqft" },
    edging_line: { key: "edging_lf", field: "length_ft" },
    fence_line: { key: "fence_lf", field: "length_ft" },
    canopy: { key: "canopy_sqft", field: "area_sqft" },
    roof: { key: "roof_sqft", field: "area_sqft" },
  };
  for (const feature of measurement?.measurement_features ?? []) {
    const mapped = quantityKey[feature.category];
    if (!mapped) continue;
    addQty(mapped.key, Number(feature[mapped.field] ?? 0));
  }
  if (!quantities.turf_sqft && quote.properties?.lot_sqft) quantities.lot_sqft = Number(quote.properties.lot_sqft);

  const picked = defaultSelectedIds(lines);
  const total = sumSelected(lines, picked, "price");
  const hours = sumSelected(lines, picked, "hours");
  const cost = sumSelected(lines, picked, "cost");
  const editable = quote.status === "draft" || quote.status === "changed";
  const canRevise = quote.status === "sent" || quote.status === "viewed" || quote.status === "declined" || quote.status === "expired";
  const turf = (quantities.turf_front_sqft ?? 0) + (quantities.turf_back_sqft ?? 0);
  const basis = turf > 0 ? `Priced from ${Math.round(turf).toLocaleString("en-US")} sq ft` : "Priced from this property";

  return (
    <>
      <PageHeader
        title={`Quote #${quote.number} · ${quote.title}`}
        description={`${quote.accounts?.name ?? ""}${quote.properties?.formatted_address ? ` · ${quote.properties.formatted_address}` : ""}`}
        actions={
          <>
            <SendQuoteButton quoteId={quote.id} token={quote.public_token} status={quote.status} />
            {convertedAgreement ? (
              <Button variant="outline" render={<Link href={`/agreements/${convertedAgreement.id}`} />}>
                View agreement
              </Button>
            ) : null}
            {canRevise ? <ReviseQuoteButton quoteId={quote.id} /> : null}
            {quote.status !== "draft" ? (
              <Button variant="outline" render={<Link href={`/q/${quote.public_token}`} target="_blank" />}>
                View proposal
              </Button>
            ) : null}
            {quote.status !== "accepted" && hasRole(session.orgRole, ADMIN_ROLES) ? <DeleteQuoteButton quoteId={quote.id} /> : null}
          </>
        }
      />
      <div className="page-pad grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <QuoteLines
            quoteId={quote.id}
            versionId={versionId}
            basis={basis}
            editable={editable}
            lines={lines.map((line) => ({
              id: line.id,
              name: line.name,
              state: line.state,
              option_group: line.option_group,
              option_tier: line.option_tier,
              price: Number(line.price),
              inTotal: picked.includes(line.id),
            }))}
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
          <ProposalCard quote={quote} editable={editable} />
          {!editable ? (
            <p className="text-sm text-muted-foreground">
              {quote.status === "accepted"
                ? "This proposal is accepted and locked."
                : "This proposal is frozen. Revise it to change the work or the price. The public link is hidden until you send the revision."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          {canConvert ? <ConvertToJobForm quoteId={quote.id} defaultStartDate={orgToday(org?.timezone)} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              <div className="flex justify-between">
                <span>Price</span>
                <span className="font-heading text-xl font-semibold tabular-nums">
                  {formatMoney(total, { cents: true })}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Hours</span>
                <span>{hours.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Cost</span>
                <span className="font-heading tabular-nums">{formatMoney(cost, { cents: true })}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Margin</span>
                <span>{total > 0 ? `${Math.round(((total - cost) / total) * 100)}%` : "—"}</span>
              </div>
            </CardContent>
          </Card>
          <InternalCard quote={quote} editable={editable} />
        </div>
      </div>
    </>
  );
}
