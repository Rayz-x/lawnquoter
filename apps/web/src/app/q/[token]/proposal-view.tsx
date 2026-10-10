"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { companyInitials, logoShowsName } from "@/lib/brand/initials";
import { type PublicOrg } from "@/lib/brand/public-org";
import { brandingAssetUrl } from "@/lib/brand/urls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatMoney, formatMoneyRange } from "@/lib/money";
import { formatNotToExceedAmount, notToExceedClause } from "@/lib/quotes/legal-copy";
import { acceptanceTotals, lineHasRange } from "@/lib/quotes/not-to-exceed";
import type { PublicAcceptance, PublicQuote, PublicSiteCheck } from "@/lib/quotes/public-quote";
import { defaultSelectedIds } from "@/lib/quotes/selection";
import { quoteSectionTotals } from "@/lib/quotes/section-totals";
import {
  SITE_CHECK_EXPLANATION_TITLE,
  SITE_CHECK_LINE_PILL,
  acceptUpToLabel,
  hasSiteCheck,
  siteCheckCustomerBody,
  siteCheckMeasuringPill,
  siteCheckWhatHappensNext,
  youPayNoMoreThan,
} from "@/lib/quotes/site-check";
import { AcceptForm } from "./accept-form";
import { RecordView } from "./record-view";
import { RequestFinalPrice } from "./request-final-price";

type Item = PublicQuote["items"][number];
type Section = NonNullable<PublicQuote["sections"]>[number];

const POWERED_BY = "https://lawnquoter.com/?utm_source=lawnquoter&utm_medium=quote&utm_campaign=powered_by";
const LIVE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function priceBlock(item: Item) {
  if (lineHasRange(item)) {
    return (
      <span className="shrink-0 text-right font-heading tabular-nums">
        <span className="block">{formatMoneyRange(Number(item.range_low), Number(item.range_high))}</span>
        <span className="block text-xs text-muted-foreground">est. {formatMoney(Number(item.price))}</span>
      </span>
    );
  }
  return <span className="shrink-0 font-heading tabular-nums">{formatMoney(Number(item.price))}</span>;
}

function SiteCheckPill({ label }: { label?: string | null }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      {label || SITE_CHECK_LINE_PILL}
    </span>
  );
}

function QuoteMark({ org }: { org: PublicOrg }) {
  const light = brandingAssetUrl(org.logo_url);
  const dark = brandingAssetUrl(org.logo_dark_url);
  const showName = logoShowsName(org);
  const width = org.logo_width ?? 220;
  const height = org.logo_height ?? 48;
  const name = (
    <span className={showName && light ? "font-heading text-xl text-foreground" : "font-heading text-xl text-[var(--brand-text)]"}>
      {showName || !light ? org.name : null}
    </span>
  );

  if (!light) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary font-heading text-sm font-semibold text-primary-foreground">
          {companyInitials(org.name)}
        </span>
        {name}
      </div>
    );
  }

  const chip = org.logo_needs_chip && !dark;
  const frame = chip
    ? "dark:rounded-md dark:border dark:border-white/[0.08] dark:bg-white dark:p-2"
    : "";
  return (
    <div className="flex items-center gap-3">
      <span className={frame}>
        {/* SVG logos are served as images, never inlined. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={light}
          alt={org.name}
          width={width}
          height={height}
          className={`w-auto max-w-[180px] object-contain object-left sm:max-w-[220px] ${dark ? "dark:hidden" : ""} h-10 max-h-10 sm:h-12 sm:max-h-12`}
        />
        {dark ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dark}
            alt=""
            width={width}
            height={height}
            className="hidden h-10 max-h-10 w-auto max-w-[180px] object-contain object-left sm:h-12 sm:max-h-12 sm:max-w-[220px] dark:block"
          />
        ) : null}
      </span>
      {showName ? name : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "accepted") return <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Accepted</span>;
  if (status === "declined") return <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Declined</span>;
  if (status === "expired") return <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Expired</span>;
  return null;
}

function OptionGroupBlock({
  group,
  options,
  value,
  onChange,
  measuringPill,
}: {
  group: string;
  options: Item[];
  value: string | undefined;
  onChange: (id: string) => void;
  measuringPill: string | null;
}) {
  return (
    <section className="rounded-xl border p-4">
      <h3 className="font-medium">{group}</h3>
      <RadioGroup value={value} onValueChange={onChange} className="mt-3 grid gap-2">
        {options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 has-data-[checked]:border-[var(--brand-edge)] has-data-[checked]:bg-[var(--brand-soft)]"
          >
            <RadioGroupItem value={o.id} className="mt-1" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 font-medium capitalize [overflow-wrap:anywhere]">
                  {o.option_tier === "none" ? o.name : o.option_tier}
                </span>
                {priceBlock(o)}
              </div>
              {o.description ? <p className="text-xs text-muted-foreground">{o.description}</p> : null}
              {hasSiteCheck(o.site_check_reasons) || (lineHasRange(o) && measuringPill) ? (
                <SiteCheckPill label={measuringPill} />
              ) : null}
            </div>
          </label>
        ))}
      </RadioGroup>
    </section>
  );
}

function StandaloneLine({
  item,
  extras,
  onExtra,
  measuringPill,
}: {
  item: Item;
  extras: Record<string, boolean>;
  onExtra: (id: string, checked: boolean) => void;
  measuringPill: string | null;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border p-4 has-data-[checked]:border-[var(--brand-edge)] has-data-[checked]:bg-[var(--brand-soft)]">
      {item.state === "included" ? (
        <span className="mt-0.5 text-xs text-muted-foreground">Included</span>
      ) : (
        <Checkbox
          checked={!!extras[item.id]}
          onCheckedChange={(checked) => onExtra(item.id, !!checked)}
          className="mt-1"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</span>
          {priceBlock(item)}
        </div>
        {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
        {hasSiteCheck(item.site_check_reasons) || (lineHasRange(item) && measuringPill) ? (
          <SiteCheckPill label={measuringPill} />
        ) : null}
        {item.state === "recommended" ? (
          <span className="mt-1 inline-flex rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand-text)]">
            Recommended
          </span>
        ) : null}
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.photo_url}
            alt=""
            className="mt-2 w-full rounded-md bg-muted object-cover [aspect-ratio:16/9] [block-size:auto]"
          />
        ) : null}
      </div>
    </label>
  );
}

function itemsForBucket(items: Item[], sectionId: string | null, known: Set<string>) {
  if (sectionId) return items.filter((item) => item.section_id === sectionId);
  return items.filter((item) => !item.section_id || !known.has(item.section_id));
}

function groupNames(items: Item[]) {
  return [...new Set(items.filter((item) => item.option_group).map((item) => item.option_group!))];
}

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
    site_check?: PublicSiteCheck | null;
    site_check_can_request?: boolean | null;
    site_check_account_cap_reached?: boolean | null;
    org: PublicOrg;
    sections?: Section[];
    items: Item[];
    acceptance?: PublicAcceptance | null;
  };
}) {
<<<<<<< HEAD
  const measuringPill = siteCheckMeasuringPill(
    payload.site_check?.window_start,
    payload.site_check?.window_end,
  );
  const sections = payload.sections ?? [];
=======
  const sections = useMemo(() => payload.sections ?? [], [payload.sections]);
>>>>>>> ad5fa92 (Stabilize proposal sections memo for lint)
  const known = useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
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
  const breakdown = useMemo(
    () => quoteSectionTotals(payload.items, sections.map((section) => ({ id: section.id, title: section.title })), selectedIds),
    [payload.items, sections, selectedIds],
  );
  const stored = payload.status === "accepted" ? (payload.acceptance ?? null) : null;
  const hasRanges = stored?.has_ranges ?? live.hasRanges;
  const notToExceed = stored?.accepted_not_to_exceed ?? live.notToExceed;
  const estimate = stored?.accepted_total ?? live.acceptedTotal;
  const nteLabel = formatNotToExceedAmount(notToExceed);
  const clause = hasRanges ? (stored?.not_to_exceed_clause ?? notToExceedClause(nteLabel)) : null;
  const selectedItems = payload.items.filter((item) => selectedIds.includes(item.id));
  const selectedFlagged = selectedItems.filter((item) => hasSiteCheck(item.site_check_reasons));
  const selectedRanged = selectedItems.filter((item) => lineHasRange(item));
  const explanationReasons = selectedFlagged.flatMap((item) => item.site_check_reasons ?? []);
  const showExplanation = selectedFlagged.length > 0;
  const estimateLow = selectedItems.reduce(
    (sum, item) => sum + (lineHasRange(item) ? Number(item.range_low) : Number(item.price)),
    0,
  );
  const estimateHigh = selectedItems.reduce(
    (sum, item) => sum + (lineHasRange(item) ? Number(item.range_high) : Number(item.price)),
    0,
  );
  const website = payload.org.website;
  const buckets: { id: string; title: string | null; items: Item[]; subtotal: number }[] = [
    ...sections.map((section) => ({
      id: section.id,
      title: section.title,
      items: itemsForBucket(payload.items, section.id, known),
      subtotal: breakdown.sections.find((row) => row.id === section.id)?.price ?? 0,
    })),
    {
      id: "add-ons",
      title: sections.length ? "Add-ons" : null,
      items: itemsForBucket(payload.items, null, known),
      subtotal: breakdown.addOns.price,
    },
  ].filter((bucket) => bucket.items.length > 0);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="fixed inset-x-0 top-0 z-30 h-1 bg-primary" />
      <main className="mx-auto min-h-svh max-w-xl px-4 py-10 [padding-inline-start:max(1rem,env(safe-area-inset-left,0px))] [padding-inline-end:max(1rem,env(safe-area-inset-right,0px))]">
        {LIVE_TOKEN.test(token) ? <RecordView token={token} status={payload.status} /> : null}
        <div className="flex items-start justify-between gap-3">
          <QuoteMark org={payload.org} />
          <StatusBadge status={payload.status} />
        </div>
        <h1 className="mt-5 text-3xl font-bold">{payload.title}</h1>
        <p className="text-sm text-muted-foreground">Quote #{payload.number}</p>
        {payload.intro ? <p className="mt-4 text-lg leading-7">{payload.intro}</p> : null}

        <div className="mt-6 flex flex-col gap-6">
          {buckets.map((bucket) => {
            const groups = groupNames(bucket.items);
            const standalones = bucket.items.filter((item) => !item.option_group);
            return (
              <section key={bucket.id} className="flex flex-col gap-3" aria-label={bucket.title ?? "Quote lines"}>
                {bucket.title ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-heading text-xl font-semibold">{bucket.title}</h2>
                    <span className="font-heading text-sm tabular-nums text-muted-foreground">
                      {formatMoney(bucket.subtotal, { cents: true })}
                    </span>
                  </div>
                ) : null}
                {groups.map((g) => (
                  <OptionGroupBlock
                    key={g}
                    group={g}
                    options={bucket.items.filter((item) => item.option_group === g)}
                    value={picked[g]}
                    onChange={(id) => setPicked((prev) => ({ ...prev, [g]: id }))}
                    measuringPill={measuringPill}
                  />
                ))}
                {standalones.map((item) => (
                  <StandaloneLine
                    key={item.id}
                    item={item}
                    extras={extras}
                    onExtra={(id, checked) => setExtras((prev) => ({ ...prev, [id]: checked }))}
                    measuringPill={measuringPill}
                  />
                ))}
              </section>
            );
          })}
        </div>

        {showExplanation ? (
          <section className="mt-6 rounded-xl bg-warning/10 p-4 text-sm ring-1 ring-warning/30" aria-labelledby="site-check-explain">
            <h2 id="site-check-explain" className="font-medium text-warning">
              {SITE_CHECK_EXPLANATION_TITLE}
            </h2>
            <p className="mt-2">{siteCheckCustomerBody(explanationReasons)}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5">
              {siteCheckWhatHappensNext(nteLabel).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ) : null}
        {LIVE_TOKEN.test(token) ? (
          <RequestFinalPrice
            token={token}
            selectedIds={selectedIds}
            rangedLineNames={selectedRanged.map((item) => item.name)}
            phone={payload.org.phone}
            siteCheck={payload.site_check}
            canRequest={payload.site_check_can_request === true}
            accountCapReached={payload.site_check_account_cap_reached === true}
            hasSelectedRanged={selectedRanged.length > 0}
          />
        ) : null}
        <div className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t bg-background py-4 [padding-block-end:calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div>
            <div className="text-xs text-muted-foreground">{hasRanges ? "Estimated total" : "Total"}</div>
            <div className="font-heading text-2xl font-bold tabular-nums">
              {hasRanges
                ? formatMoneyRange(estimateLow, estimateHigh)
                : formatMoney(estimate, { cents: true })}
            </div>
            {hasRanges ? <div className="text-xs text-warning">{youPayNoMoreThan(nteLabel)}</div> : null}
          </div>
          <Button size="lg" render={<a href={`/q/${token}/pdf?selected=${selectedIds.join(",")}`} />}>
            Download PDF
          </Button>
        </div>
        {LIVE_TOKEN.test(token) ? (
          <AcceptForm
            token={token}
            status={payload.status}
            selectedIds={selectedIds}
            clause={clause}
            acceptLabel={hasRanges ? acceptUpToLabel(nteLabel) : "Accept"}
          />
        ) : null}
        {payload.notes_customer ? <p className="mt-4 text-sm text-muted-foreground">{payload.notes_customer}</p> : null}
        <p className="mt-6 text-xs text-muted-foreground">
          {payload.org.phone}
          {payload.org.email ? (
            <>
              {" "}
              ·{" "}
              <a className="text-[var(--brand-text)] underline" href={`mailto:${payload.org.email}`}>
                {payload.org.email}
              </a>
            </>
          ) : null}
          {website ? (
            <>
              {" "}
              ·{" "}
              <a className="text-[var(--brand-text)] underline" href={website} rel="noopener">
                {website.replace(/^https?:\/\//, "")}
              </a>
            </>
          ) : null}
        </p>
        <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
          <Image src="/brand/lq-mark-16.svg" alt="" width={16} height={16} unoptimized className="size-4" />
          <a href={POWERED_BY} rel="noopener" className="text-muted-foreground">
            Powered by LawnQuoter
          </a>
        </p>
      </main>
    </div>
  );
}
