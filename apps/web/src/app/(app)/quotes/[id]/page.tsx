import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { QUOTE_CONVERT_ROLES } from "@/lib/auth/office-roles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { catalogPickerRules, measurementQuantities, priceCatalogLine, type PropertyPricingInput } from "@/lib/quotes/catalog-price";
import { defaultSelectedIds, sumSelected } from "@/lib/quotes/selection";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";
import { ConvertToJobForm } from "./convert-to-job-button";
import { DeleteQuoteButton } from "./delete-quote-button";
import { QuoteLines } from "./quote-lines";
import { QuoteMetaForm } from "./quote-meta-form";
import { SendQuoteButton } from "./send-quote-button";
import { ReviseQuoteButton } from "./revise-quote-button";

export const metadata: Metadata = { title: "Quote" };

export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, number, title, status, created_at, current_version, intro, notes_customer, notes_internal, public_token, property_id, accounts(name), properties(formatted_address, lot_sqft, slope, gate_width_in, obstacle_count, has_stairs)",
    )
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (quoteError) {
    return (
      <>
        <PageHeader title="Quote" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this quote</AlertTitle>
            <AlertDescription>{quoteError.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!quote) notFound();

  const { data: convertedAgreement, error: agreementError } = await supabase
    .from("agreements")
    .select("id")
    .eq("org_id", session.orgId)
    .eq("quote_id", id)
    .maybeSingle();
  const canConvert =
    quote.status === "accepted" && !convertedAgreement && hasRole(session.orgRole, QUOTE_CONVERT_ROLES);
  const { data: org, error: orgError } = canConvert
    ? await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle()
    : { data: null, error: null };

  const { data: versionId, error: versionError } = await supabase.rpc("quote_current_version", { p_quote: id });
  const [
    { data: items, error: itemsError },
    { data: rules, error: rulesError },
    { data: lists, error: listError },
    { data: measurement, error: measurementError },
    { data: sections, error: sectionsError },
  ] = await Promise.all([
    versionId
      ? supabase
          .from("quote_line_items")
          .select("id, name, description, state, section_id, option_group, option_tier, selected, price, hours, cost, sort")
          .eq("version_id", versionId)
          .order("sort")
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            description: string | null;
            state: string;
            section_id: string | null;
            option_group: string | null;
            option_tier: string;
            selected: boolean;
            price: number;
            hours: number;
            cost: number;
            sort: number;
          }[],
          error: null,
        }),
    supabase.from("pricing_rules").select("id, name, rule_type, config, service_id, price_list_id").eq("org_id", session.orgId).eq("active", true),
    supabase.from("price_lists").select("id, status, modifiers").eq("org_id", session.orgId),
    quote.property_id
      ? supabase
          .from("measurements")
          .select("confidence, measurement_features(category, area_sqft, length_ft)")
          .eq("property_id", quote.property_id)
          .eq("status", "current")
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    versionId
      ? supabase.from("quote_sections").select("id, title, sort").eq("version_id", versionId).order("sort")
      : Promise.resolve({ data: [] as { id: string; title: string; sort: number }[], error: null }),
  ]);
  const listModifiers = new Map(
    (lists ?? []).filter((row) => row.status === "active").map((row) => [row.id, row.modifiers]),
  );
  const loadError =
    agreementError?.message ??
    orgError?.message ??
    versionError?.message ??
    itemsError?.message ??
    rulesError?.message ??
    listError?.message ??
    measurementError?.message ??
    sectionsError?.message ??
    null;
  if (loadError) {
    return (
      <>
        <PageHeader title="Quote" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this quote</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const lines = items ?? [];

  const features = measurement?.measurement_features ?? [];
  const propertyPricing: PropertyPricingInput = {
    lotSqft: quote.properties?.lot_sqft,
    slope: quote.properties?.slope,
    gateWidthIn: quote.properties?.gate_width_in,
    obstacleCount: quote.properties?.obstacle_count,
    hasStairs: quote.properties?.has_stairs,
    confidence: measurement?.confidence != null ? Number(measurement.confidence) : undefined,
  };

  const picked = defaultSelectedIds(lines);
  const total = sumSelected(lines, picked, "price");
  const hours = sumSelected(lines, picked, "hours");
  const cost = sumSelected(lines, picked, "cost");
  const quantities = measurementQuantities(features, propertyPricing.lotSqft);
  const turf = (quantities.turf_front_sqft ?? 0) + (quantities.turf_back_sqft ?? 0);
  const basis = turf > 0 ? `Priced from ${Math.round(turf).toLocaleString("en-US")} sq ft` : "Priced from this property";
  const editable = quote.status === "draft" || quote.status === "changed";
  const canRevise = quote.status === "sent" || quote.status === "viewed" || quote.status === "declined" || quote.status === "expired";

  return (
    <>
      <PageHeader
        title={`Quote #${quote.number} · ${quote.title}`}
        description={`${quote.accounts?.name ?? ""}${quote.properties?.formatted_address ? ` · ${quote.properties.formatted_address}` : ""}`}
        actions={
          <>
            <SendQuoteButton quoteId={quote.id} status={quote.status} />
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
            sections={(sections ?? []).map((section) => ({ id: section.id, title: section.title }))}
            lines={lines.map((line) => ({
              id: line.id,
              name: line.name,
              description: line.description,
              state: line.state,
              section_id: line.section_id,
              option_tier: line.option_tier,
              price: Number(line.price),
            }))}
            rules={catalogPickerRules(rules ?? [], lists ?? []).flatMap((rule) => {
              const stored = listModifiers.get(rule.price_list_id);
              if (stored === undefined) return [];
              const priced = priceCatalogLine({ config: rule.config, modifiers: mergeModifiers(stored), features, property: propertyPricing });
              return priced.ok ? [{ id: rule.id, name: rule.name, priced: priced.priced }] : [];
            })}
          />
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
          <QuoteMetaForm quote={quote} editable={editable} />
        </div>
      </div>
    </>
  );
}
