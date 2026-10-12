import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mergeModifiers, routeDensityRadiusMeters } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { QUOTE_CONVERT_ROLES } from "@/lib/auth/office-roles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { TextDocumentOffer } from "@/components/messaging/text-document-offer";
import { formatMoney } from "@/lib/money";
import { catalogPickerRules, measurementQuantities, monthInTimeZone, priceCatalogLine, serviceMinimumPrice, type PropertyPricingInput } from "@/lib/quotes/catalog-price";
import { defaultSelectedIds } from "@/lib/quotes/selection";
import { quoteSectionTotals } from "@/lib/quotes/section-totals";
import { diffQuoteVersions, quoteDiffLines, type QuoteVersionChange } from "@/lib/quotes/version-diff";
import {
  SITE_CHECK_REQUESTED_BADGE,
  hasSiteCheck,
  siteCheckReasonsSummary,
  siteCheckRequestWindowCopy,
} from "@/lib/quotes/site-check";
import { formatOfficeDay, orgToday } from "@/lib/scheduling/office-date";
import { QuoteLostPrompt } from "@/components/leads/quote-lost-prompt";
import { findLeadForQuote } from "@/lib/leads/supabase-store";
import { createClient } from "@/lib/supabase/server";
import { ConvertToJobForm } from "./convert-to-job-button";
import { SplitQuoteForm } from "./split-quote-form";
import { DeleteQuoteButton } from "./delete-quote-button";
import { AiDraftCard } from "./ai-draft-card";
import { ProgressBillForm } from "./progress-bill-form";
import { QuoteLines } from "./quote-lines";
import { QuoteMetaForm } from "./quote-meta-form";
import { QuoteTermsForm } from "./quote-terms-form";
import { SendQuoteButton } from "./send-quote-button";
import { SignWellCard } from "./signwell-card";
import { SiteCheckPanel } from "./site-check-panel";
import { SiteCheckRequestActions } from "./site-check-request-actions";
import { QuoteTemplateCard } from "./quote-template-card";
import { ReviseQuoteButton } from "./revise-quote-button";
import { QuoteVersionDiffCard } from "@/components/quotes/version-diff";

export const metadata: Metadata = { title: "Quote" };

export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, number, title, status, site_check_status, created_at, current_version, intro, notes_customer, notes_internal, deposit_amount, public_token, expires_at, gone_quiet_at, abandoned_at, property_id, signwell_document_id, accounts(name, type), properties(formatted_address, lot_sqft, slope, gate_width_in, obstacle_count, has_stairs, drive_minutes, drive_miles)",
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
  const { data: quoteJobs, error: quoteJobsError } = canConvert
    ? await supabase.from("jobs").select("id, title").eq("org_id", session.orgId).eq("quote_id", id)
    : { data: [], error: null };
  const alreadySplit = (quoteJobs?.length ?? 0) > 0;
  const { data: org, error: orgError } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle();

  const { data: versionId, error: versionError } = await supabase.rpc("quote_current_version", { p_quote: id });
  const [
    { data: items, error: itemsError },
    { data: rules, error: rulesError },
    { data: lists, error: listError },
    { data: measurement, error: measurementError },
    { data: sections, error: sectionsError },
    { data: openSiteCheck, error: siteCheckError },
  ] = await Promise.all([
    versionId
      ? supabase
          .from("quote_line_items")
          .select(
            "id, name, description, state, section_id, option_group, option_tier, qty, unit, selected, price, hours, cost, sort, range_low, range_high, site_check_reasons",
          )
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
            qty: number;
            unit: string;
            selected: boolean;
            price: number;
            hours: number;
            cost: number;
            sort: number;
            range_low: number | null;
            range_high: number | null;
            site_check_reasons: string[];
          }[],
          error: null,
        }),
    supabase.from("pricing_rules").select("id, name, rule_type, config, service_id, price_list_id, services(minimum_price)").eq("org_id", session.orgId).eq("active", true),
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
    supabase
      .from("site_checks")
      .select("id, status, origin, requested_email, request_note, window_start, window_end, decline_reason")
      .eq("quote_id", id)
      .eq("org_id", session.orgId)
      .in("status", ["requested", "open", "scheduled", "declined"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const listModifiers = new Map(
    (lists ?? []).filter((row) => row.status === "active").map((row) => [row.id, row.modifiers]),
  );
  const loadError =
    agreementError?.message ??
    quoteJobsError?.message ??
    orgError?.message ??
    versionError?.message ??
    itemsError?.message ??
    rulesError?.message ??
    listError?.message ??
    measurementError?.message ??
    sectionsError?.message ??
    siteCheckError?.message ??
    null;
  const activeModifiers = mergeModifiers(listModifiers.values().next().value);
  let nearbyStops: number | undefined;
  let nearbyError: string | null = null;
  if (quote.property_id && (activeModifiers.routeDensity?.discountPct ?? 0) > 0) {
    const near = await supabase.rpc("properties_near", {
      p_property: quote.property_id,
      p_radius_m: routeDensityRadiusMeters(activeModifiers),
    });
    nearbyError = near.error?.message ?? null;
    nearbyStops = near.data?.length ?? 0;
  }
  const pageError = loadError ?? nearbyError;
  if (pageError) {
    return (
      <>
        <PageHeader title="Quote" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this quote</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  let versionChanges: QuoteVersionChange[] | null = null;
  if (quote.current_version > 1) {
    const { data: previous, error: previousError } = await supabase
      .from("quote_versions")
      .select("id, version")
      .eq("quote_id", id)
      .eq("org_id", session.orgId)
      .eq("version", quote.current_version - 1)
      .maybeSingle();
    if (!previousError && previous) {
      const [{ data: previousSections, error: previousSectionError }, { data: previousItems, error: previousItemError }] =
        await Promise.all([
          supabase.from("quote_sections").select("id, title").eq("version_id", previous.id),
          supabase.from("quote_line_items").select("section_id, name, qty, unit, price, state, sort").eq("version_id", previous.id),
        ]);
      if (!previousSectionError && !previousItemError) {
        versionChanges = diffQuoteVersions(
          quoteDiffLines({ sections: previousSections ?? [], items: previousItems ?? [] }),
          quoteDiffLines({ sections: sections ?? [], items: items ?? [] }),
        );
      }
    }
  }

  const lines = (items ?? []).map((line) => ({
    ...line,
    range_low: line.range_low != null ? Number(line.range_low) : null,
    range_high: line.range_high != null ? Number(line.range_high) : null,
    site_check_reasons: line.site_check_reasons ?? [],
  }));

  const features = measurement?.measurement_features ?? [];
  const confidence = measurement?.confidence != null ? Number(measurement.confidence) : null;
  const propertyPricing: PropertyPricingInput = {
    lotSqft: quote.properties?.lot_sqft,
    slope: quote.properties?.slope,
    gateWidthIn: quote.properties?.gate_width_in,
    obstacleCount: quote.properties?.obstacle_count,
    hasStairs: quote.properties?.has_stairs,
    confidence: confidence ?? undefined,
    driveMinutes: quote.properties?.drive_minutes,
    driveMiles: quote.properties?.drive_miles,
    nearbyStops,
    serviceMonth: monthInTimeZone(new Date(), org?.timezone),
  };

  const picked = defaultSelectedIds(lines);
  const pickedSet = new Set(picked);
  const sectionBreakdown = quoteSectionTotals(
    lines,
    (sections ?? []).map((section) => ({ id: section.id, title: section.title })),
    picked,
  );
  const total = sectionBreakdown.total.price;
  const hours = sectionBreakdown.total.hours;
  const cost = sectionBreakdown.total.cost;
  const knownSectionIds = new Set(sectionBreakdown.sections.map((section) => section.id));
  const hasAddOns = lines.some((line) => !line.section_id || !knownSectionIds.has(line.section_id));
  const selectedFlagged = lines.filter(
    (line) => pickedSet.has(line.id) && hasSiteCheck(line.site_check_reasons),
  );
  const siteCheckCount = selectedFlagged.length;
  const finalPriceRequested = quote.site_check_status === "requested" || openSiteCheck?.status === "requested";
  const siteCheckWindowCopy = siteCheckRequestWindowCopy(
    openSiteCheck?.window_start,
    openSiteCheck?.window_end,
  );
  const estimateLow = lines
    .filter((line) => pickedSet.has(line.id))
    .reduce((sum, line) => sum + (line.range_low ?? Number(line.price)), 0);
  const estimateHigh = lines
    .filter((line) => pickedSet.has(line.id))
    .reduce((sum, line) => sum + (line.range_high ?? Number(line.price)), 0);
  const hasRangeTotal = estimateLow !== estimateHigh;
  const quantities = measurementQuantities(features, propertyPricing.lotSqft);
  const turf = (quantities.turf_front_sqft ?? 0) + (quantities.turf_back_sqft ?? 0);
  const basis = turf > 0 ? `Priced from ${Math.round(turf).toLocaleString("en-US")} sq ft` : "Priced from this property";
  const canEditQuote = hasRole(session.orgRole, SALES_ROLES);
  const editable = canEditQuote && (quote.status === "draft" || quote.status === "changed");
  const { data: templates } = editable
    ? await supabase.from("quote_templates").select("id, name, service_kind").eq("org_id", session.orgId).order("name")
    : { data: [] };
  const canRevise =
    canEditQuote &&
    (quote.status === "sent" || quote.status === "viewed" || quote.status === "declined" || quote.status === "expired");
  const linkedLead =
    quote.status === "declined" || quote.status === "expired"
      ? await findLeadForQuote(supabase, { orgId: session.orgId, quoteId: quote.id })
      : null;

  return (
    <>
      <PageHeader
        title={`Quote #${quote.number} · ${quote.title}`}
        description={`${quote.accounts?.name ?? ""}${quote.properties?.formatted_address ? ` · ${quote.properties.formatted_address}` : ""}`}
        actions={
          <>
            {canEditQuote ? <SendQuoteButton quoteId={quote.id} status={quote.status} /> : null}
            <TextDocumentOffer
              purpose="quote"
              id={quote.id}
              label="Text proposal"
              allowed={canEditQuote && ["draft", "changed", "sent", "viewed"].includes(quote.status)}
            />
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
      <div className="page-pad grid items-start gap-4 pb-20 md:pb-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3">
          {linkedLead ? (
            <QuoteLostPrompt
              quoteId={quote.id}
              quoteStatus={quote.status}
              leadId={linkedLead.id}
              leadStatus={linkedLead.status}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">{quote.status}</Badge>
            {quote.abandoned_at ? (
              <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">Abandoned</Badge>
            ) : null}
            {quote.gone_quiet_at ? (
              <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">Gone quiet</Badge>
            ) : null}
            {finalPriceRequested ? (
              <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                {SITE_CHECK_REQUESTED_BADGE}
              </Badge>
            ) : null}
            {quote.expires_at ? (
              <Badge
                variant="outline"
                className={
                  quote.status === "expired"
                    ? "border-transparent bg-destructive/12 text-destructive"
                    : undefined
                }
              >
                {quote.status === "expired"
                  ? `Expired ${formatOfficeDay(quote.expires_at)}`
                  : `Expires ${formatOfficeDay(quote.expires_at)}`}
              </Badge>
            ) : null}
            {siteCheckCount > 0 ? (
              <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                Needs site check · {siteCheckCount} line{siteCheckCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
          {editable && quote.property_id ? (
            <AiDraftCard quoteId={quote.id} connected={Boolean(process.env.AI_QUOTE_API_KEY?.trim() && process.env.AI_QUOTE_API_URL?.trim())} />
          ) : null}
          {editable ? <QuoteTemplateCard quoteId={quote.id} templates={templates ?? []} /> : null}
          {versionChanges ? <QuoteVersionDiffCard fromVersion={quote.current_version - 1} changes={versionChanges} /> : null}
          <QuoteLines
            quoteId={quote.id}
            versionId={versionId}
            basis={basis}
            editable={editable}
            selectedIds={picked}
            sectionTotals={sectionBreakdown.sections}
            addOnTotal={sectionBreakdown.addOns.price}
            sections={(sections ?? []).map((section) => ({ id: section.id, title: section.title }))}
            lines={lines.map((line) => ({
              id: line.id,
              name: line.name,
              description: line.description,
              state: line.state,
              section_id: line.section_id,
              option_group: line.option_group,
              option_tier: line.option_tier,
              price: Number(line.price),
              range_low: line.range_low,
              range_high: line.range_high,
              site_check_reasons: line.site_check_reasons,
            }))}
            rules={catalogPickerRules(rules ?? [], lists ?? []).flatMap((rule) => {
              const stored = listModifiers.get(rule.price_list_id);
              if (stored === undefined) return [];
              const priced = priceCatalogLine({ config: rule.config, modifiers: mergeModifiers(stored), features, property: propertyPricing, serviceMinimum: serviceMinimumPrice(rule) });
              return priced.ok ? [{ id: rule.id, name: rule.name, priced: priced.priced }] : [];
            })}
          />
          <SiteCheckPanel
            quoteId={quote.id}
            editable={editable}
            confidence={confidence}
            selectedIds={picked}
            lines={lines.map((line) => ({
              id: line.id,
              name: line.name,
              price: Number(line.price),
              range_low: line.range_low,
              range_high: line.range_high,
              site_check_reasons: line.site_check_reasons,
            }))}
          />
          {!editable ? (
            <p className="text-sm text-muted-foreground">
              {quote.status === "accepted"
                ? "This proposal is accepted and locked."
                : "This proposal is frozen. Revise it to change the work or the price. The public link is hidden until you send the revision."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--app-header-height)+3.25rem)]">
          {quote.accounts?.type === "commercial" ? (
            <Card>
              <CardHeader>
                <CardTitle>Commercial contract</CardTitle>
              </CardHeader>
              <CardContent>
                <SignWellCard
                  quoteId={quote.id}
                  connected={Boolean(process.env.SIGNWELL_API_KEY?.trim() && process.env.SIGNWELL_WEBHOOK_ID?.trim())}
                  sent={Boolean(quote.signwell_document_id)}
                  canEdit={hasRole(session.orgRole, QUOTE_CONVERT_ROLES)}
                />
              </CardContent>
            </Card>
          ) : null}
          {canConvert && !alreadySplit ? <ConvertToJobForm quoteId={quote.id} defaultStartDate={orgToday(org?.timezone)} /> : null}
          {canConvert && !alreadySplit ? (
            <SplitQuoteForm
              quoteId={quote.id}
              lines={lines.map((line) => ({ id: line.id, name: line.name, price: Number(line.price) }))}
            />
          ) : null}
          {alreadySplit ? (
            <p className="text-sm text-muted-foreground">This quote is already split into {(quoteJobs ?? []).map((job) => job.title).join(", ")}.</p>
          ) : null}
          {quote.status === "accepted" && hasRole(session.orgRole, QUOTE_CONVERT_ROLES) ? (
            <Card>
              <CardHeader>
                <CardTitle>Progress billing</CardTitle>
              </CardHeader>
              <CardContent>
                <ProgressBillForm
                  quoteId={quote.id}
                  lines={(items ?? []).filter((line) => line.selected).map((line) => ({
                    id: line.id,
                    name: line.name,
                    price: Number(line.price),
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm tabular-nums">
              {sectionBreakdown.sections.length > 0 ? (
                <>
                  {sectionBreakdown.sections.map((section) => (
                    <div key={section.id} className="flex justify-between text-muted-foreground">
                      <span>{section.title}</span>
                      <span className="font-heading tabular-nums">{formatMoney(section.price, { cents: true })}</span>
                    </div>
                  ))}
                  {hasAddOns ? (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Add-ons</span>
                      <span className="font-heading tabular-nums">{formatMoney(sectionBreakdown.addOns.price, { cents: true })}</span>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className={`flex justify-between${sectionBreakdown.sections.length > 0 ? " border-t pt-2" : ""}`}>
                <span>{hasRangeTotal ? "Estimate" : "Price"}</span>
                <span className="num text-xl font-semibold">
                  {hasRangeTotal
                    ? `${formatMoney(estimateLow, { cents: true })} – ${formatMoney(estimateHigh, { cents: true })}`
                    : formatMoney(total, { cents: true })}
                </span>
              </div>
              {hasRangeTotal ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Not to exceed</span>
                  <span className="font-heading tabular-nums">{formatMoney(estimateHigh, { cents: true })}</span>
                </div>
              ) : null}
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
          {siteCheckCount > 0 || openSiteCheck ? (
            <Card className="border-warning/30 bg-warning/5">
              <CardHeader>
                <CardTitle className="text-warning">Site check</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="capitalize">
                  {openSiteCheck
                    ? openSiteCheck.origin === "customer_request"
                      ? openSiteCheck.status === "requested"
                        ? "Customer asked for a final price · Waiting for your approval"
                        : `Customer request · ${openSiteCheck.status}`
                      : openSiteCheck.status
                    : "Created on acceptance"}
                </p>
                {siteCheckWindowCopy ? <p>{siteCheckWindowCopy}</p> : null}
                {openSiteCheck?.status === "declined" && openSiteCheck.decline_reason ? (
                  <p className="text-muted-foreground">Declined: {openSiteCheck.decline_reason}</p>
                ) : null}
                {siteCheckCount > 0 ? (
                  <p className="text-muted-foreground">
                    {siteCheckCount} line{siteCheckCount === 1 ? "" : "s"} ·{" "}
                    {siteCheckReasonsSummary(selectedFlagged.flatMap((line) => line.site_check_reasons))}
                  </p>
                ) : null}
                {openSiteCheck?.status === "requested" && openSiteCheck.origin === "customer_request" ? (
                  <SiteCheckRequestActions
                    quoteId={quote.id}
                    siteCheckId={openSiteCheck.id}
                    requestedEmail={openSiteCheck.requested_email}
                    requestNote={openSiteCheck.request_note}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <QuoteTermsForm
            quoteId={quote.id}
            depositAmount={quote.deposit_amount != null ? Number(quote.deposit_amount) : null}
            expiresAt={quote.expires_at}
            editable={editable}
          />
          <QuoteMetaForm quote={quote} editable={editable} />
        </div>
      </div>
      <div className="office-dock flex items-center gap-3 border-t bg-background px-4 py-2 md:hidden">
        <span className="num text-lg font-semibold">{formatMoney(total, { cents: true })}</span>
        <span className="flex h-11 min-h-11 flex-1 [&_button]:h-11 [&_button]:w-full">
          <SendQuoteButton quoteId={quote.id} status={quote.status} />
        </span>
      </div>
    </>
  );
}
