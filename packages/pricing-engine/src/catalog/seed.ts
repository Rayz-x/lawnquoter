import type { PricingRule, QuantityMap, TierRow } from "../types";

/**
 * Prebuilt service catalog, v1 (specs/service-catalog-v1.md, decisions approved Oct 11, 2026).
 * Starter prices are national planning benchmarks, not quotes. "typical" is the midpoint of the
 * source's published range. Cost and hours stay 0 ("set your cost") where sources give only a price.
 */
export const CATALOG_VERSION = "2026-10-11";

export const CATALOG_CATEGORIES = [
  "Mowing",
  "Lawn treatment",
  "Lawn renovation",
  "Cleanups",
  "Beds & shrubs",
  "Irrigation",
  "Snow",
  "Other",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export type CatalogServiceKind = "mowing" | "fert" | "cleanup" | "snow" | "irrigation" | "install" | "other";

/** How the starter price becomes an engine rule. */
type Shape =
  | { kind: "mow_tiers"; base: readonly [number, number, number]; tail: number }
  | { kind: "per_unit"; quantityKey: string; step: number }
  | { kind: "flat" }
  | { kind: "mulch" }
  | { kind: "program"; applications: number }
  | { kind: "zones_base"; baseZones: number; perExtraZone: number }
  | { kind: "snow"; contract: "per_push" | "seasonal_flat" };

export type CatalogEntry = {
  key: string;
  name: string;
  category: CatalogCategory;
  kind: CatalogServiceKind;
  description: string;
  crewTask: string;
  unitLabel: string;
  recurring: boolean;
  /** Middle Tennessee default window as MM-DD, or null for year-round / on demand. */
  season: { start: string; end: string } | null;
  taxable: false;
  isMaterial: boolean;
  starter: { low: number; typical: number; high: number };
  source: { label: string; url: string; date: string };
  shape: Shape;
  /** Quantities for exactly one pricing unit (used to show and test the unit price). */
  unitQuantities: QuantityMap;
};

export type CatalogRuleOptions = { mulchDepthIn?: number };

/** 1 cubic yard = 324 sq ft at 1 in deep (Lawn Love: about 162 sq ft at 2 in). */
export function mulchSqftPerYard(depthIn: number): number {
  return Math.round(324 / depthIn);
}

const zero = { hours: 0, cost: 0 };
const perUnitRule = (quantityKey: string, step: number, price: number): PricingRule => ({
  type: "tier_matrix",
  quantityKey,
  rows: [{ upTo: step, price, ...zero }],
  tail: { every: step, over: step, addPrice: price, addHours: 0, addCost: 0 },
});
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build the engine rule for an entry at the owner's chosen unit price. */
export function buildCatalogRule(entry: CatalogEntry, price: number, opts: CatalogRuleOptions = {}): PricingRule {
  const s = entry.shape;
  switch (s.kind) {
    case "mow_tiers": {
      const scale = price / entry.starter.typical;
      const rows: TierRow[] = [
        { upTo: 5000, price: round2(s.base[0] * scale), ...zero },
        { upTo: 10000, price: round2(s.base[1] * scale), ...zero },
        { upTo: null, price: round2(s.base[2] * scale), ...zero },
      ];
      return {
        type: "tier_matrix",
        quantityKey: "turf_sqft",
        rows,
        tail: { every: 1000, over: 15000, addPrice: round2(s.tail * scale), addHours: 0, addCost: 0 },
      };
    }
    case "per_unit":
      return perUnitRule(s.quantityKey, s.step, price);
    case "mulch":
      return perUnitRule("bed_sqft", mulchSqftPerYard(opts.mulchDepthIn ?? 2), price);
    case "flat":
      return { type: "tier_matrix", quantityKey: "each", rows: [{ upTo: null, price, ...zero }] };
    case "program":
      return {
        type: "program",
        applicationCount: s.applications,
        perApp: { price, ...zero },
        prepayDiscountPct: 0,
        billing: "per_app",
      };
    case "zones_base":
      return {
        type: "tier_matrix",
        quantityKey: "zones",
        rows: [{ upTo: s.baseZones, price, ...zero }, { upTo: null, price, ...zero }],
        tail: { every: 1, over: s.baseZones, addPrice: s.perExtraZone, addHours: 0, addCost: 0 },
      };
    case "snow":
      return s.contract === "per_push"
        ? { type: "snow", contract: "per_push", perPush: { price, ...zero }, triggerDepthIn: 2 }
        : { type: "snow", contract: "seasonal_flat", seasonal: { price, ...zero }, triggerDepthIn: 2 };
  }
}

const HG = (label: string, slug: string) => ({ label: `HomeGuide ${label} (2026)`, url: `https://homeguide.com/costs/${slug}`, date: "2026" });
const LS = (label: string, slug: string, date: string) => ({
  label: `LawnStarter ${label} (${date})`,
  url: `https://www.lawnstarter.com/blog/cost/${slug}/`,
  date,
});
const p = (low: number, typical: number, high: number) => ({ low, typical, high });
const FALL = { start: "09-01", end: "10-31" };
const SPRING = { start: "03-01", end: "05-15" };

type Draft = Omit<CatalogEntry, "taxable" | "isMaterial" | "unitQuantities"> & { isMaterial?: boolean };

function unitQuantities(shape: Shape): QuantityMap {
  switch (shape.kind) {
    case "mow_tiers":
      return { turf_sqft: 8000 };
    case "per_unit":
      return { [shape.quantityKey]: shape.step };
    case "mulch":
      return { bed_sqft: mulchSqftPerYard(2) };
    case "zones_base":
      return { zones: shape.baseZones };
    case "snow":
      return { inches: 4 };
    default:
      return {};
  }
}

const DRAFTS: Draft[] = [
  { key: "weekly-mowing", name: "Weekly mowing (trim, edge, blow)", category: "Mowing", kind: "mowing", description: "Weekly mowing with string trimming, edging along hard surfaces, and blowing clippings off walks and drives.", crewTask: "Mow, trim, edge, blow", unitLabel: "per visit by lawn size", recurring: true, season: { start: "03-15", end: "11-15" }, starter: p(45, 55, 65), source: HG("lawn mowing cost", "lawn-mowing-cost"), shape: { kind: "mow_tiers", base: [40, 55, 70], tail: 5 } },
  { key: "biweekly-mowing", name: "Biweekly mowing", category: "Mowing", kind: "mowing", description: "Mowing every other week with trimming, edging, and blowing.", crewTask: "Mow, trim, edge, blow", unitLabel: "per visit by lawn size", recurring: true, season: { start: "03-15", end: "11-15" }, starter: p(60, 72.5, 85), source: HG("lawn mowing cost", "lawn-mowing-cost"), shape: { kind: "mow_tiers", base: [52, 71.5, 91], tail: 6.5 } },
  { key: "mowing-small-lot", name: "Mowing, small lot", category: "Mowing", kind: "mowing", description: "Mowing, trimming, and blowing for lots about 1/8 to 1/4 acre.", crewTask: "Mow small lot", unitLabel: "per visit", recurring: true, season: { start: "03-15", end: "11-15" }, starter: p(30, 57.5, 85), source: HG("lawn mowing cost", "lawn-mowing-cost"), shape: { kind: "flat" } },
  { key: "mowing-large-lot", name: "Mowing, large lot", category: "Mowing", kind: "mowing", description: "Mowing for larger properties, priced per acre each visit.", crewTask: "Mow large lot", unitLabel: "per acre per visit", recurring: true, season: { start: "03-15", end: "11-15" }, starter: p(60, 105, 150), source: HG("lawn mowing cost", "lawn-mowing-cost"), shape: { kind: "per_unit", quantityKey: "acres", step: 1 } },
  { key: "overgrown-mow", name: "One-time or overgrown mow", category: "Mowing", kind: "mowing", description: "A single cut, including tall or overgrown grass, with cleanup of clippings.", crewTask: "One-time cut", unitLabel: "per visit", recurring: false, season: null, starter: p(70, 110, 150), source: HG("lawn mowing cost", "lawn-mowing-cost"), shape: { kind: "flat" } },
  { key: "fert-weed-program", name: "Fertilization + weed control program", category: "Lawn treatment", kind: "fert", description: "A season program of fertilizer and weed control applications timed for your grass type.", crewTask: "Fert + weed application", unitLabel: "per application, 6 per year", recurring: true, season: { start: "02-15", end: "11-15" }, starter: p(65, 95, 125), source: { label: "Landscape Atlas (2026); Lawn Squad", url: "https://landscapeatlas.com/blog/lawn-fertilization-and-weed-control-service-costs-explained", date: "2026" }, shape: { kind: "program", applications: 6 } },
  { key: "grub-prevention", name: "Grub prevention", category: "Lawn treatment", kind: "fert", description: "A preventive grub control application to protect roots through summer.", crewTask: "Grub preventive application", unitLabel: "per application", recurring: false, season: { start: "05-01", end: "07-15" }, starter: p(50, 100, 150), source: { label: "Lawn Squad national guide", url: "https://lawnsquad.com/lawn-care-blog/how-much-does-professional-lawn-care-cost-a-national-guide/", date: "2026" }, shape: { kind: "flat" } },
  { key: "core-aeration", name: "Core aeration", category: "Lawn renovation", kind: "other", description: "Core aeration pulls plugs of soil to relieve compaction and let water and nutrients reach the roots.", crewTask: "Core aerate", unitLabel: "per 1,000 sq ft of turf", recurring: false, season: FALL, starter: p(7, 17, 27), source: LS("aeration", "lawn-aeration-price", "Oct 5, 2026"), shape: { kind: "per_unit", quantityKey: "turf_sqft", step: 1000 } },
  { key: "overseeding", name: "Overseeding", category: "Lawn renovation", kind: "other", isMaterial: true, description: "Spreading quality seed over the lawn to thicken thin areas.", crewTask: "Overseed", unitLabel: "per 1,000 sq ft of turf", recurring: false, season: FALL, starter: p(90, 120, 150), source: LS("lawn seeding", "lawn-seeding-price", "Oct 9, 2026"), shape: { kind: "per_unit", quantityKey: "turf_sqft", step: 1000 } },
  { key: "aeration-overseeding", name: "Aeration + overseeding", category: "Lawn renovation", kind: "other", isMaterial: true, description: "Core aeration followed by overseeding, the best way to renew a tired fescue lawn.", crewTask: "Aerate + overseed", unitLabel: "per 1,000 sq ft of turf", recurring: false, season: FALL, starter: p(70, 150, 230), source: LS("aeration", "lawn-aeration-price", "Oct 9, 2026"), shape: { kind: "per_unit", quantityKey: "turf_sqft", step: 1000 } },
  { key: "dethatching", name: "Dethatching", category: "Lawn renovation", kind: "other", description: "Removing the built-up layer of dead grass so the lawn can breathe.", crewTask: "Dethatch", unitLabel: "per 1,000 sq ft of turf", recurring: false, season: FALL, starter: p(10, 20, 30), source: HG("lawn dethatching cost", "lawn-dethatching-cost"), shape: { kind: "per_unit", quantityKey: "turf_sqft", step: 1000 } },
  { key: "spring-cleanup", name: "Spring cleanup", category: "Cleanups", kind: "cleanup", description: "Clearing winter debris, sticks, and leaves from lawn and beds to start the season clean.", crewTask: "Spring cleanup", unitLabel: "flat per property", recurring: false, season: SPRING, starter: p(125, 212.5, 300), source: HG("yard cleanup cost", "yard-cleanup-cost"), shape: { kind: "flat" } },
  { key: "fall-cleanup", name: "Fall cleanup", category: "Cleanups", kind: "cleanup", description: "Clearing leaves and debris from lawn and beds before winter.", crewTask: "Fall cleanup", unitLabel: "flat per property", recurring: false, season: { start: "10-15", end: "12-15" }, starter: p(150, 275, 400), source: HG("yard cleanup cost", "yard-cleanup-cost"), shape: { kind: "flat" } },
  { key: "leaf-removal", name: "Leaf removal", category: "Cleanups", kind: "cleanup", description: "Raking, blowing, and hauling away leaves.", crewTask: "Leaf removal", unitLabel: "flat per property", recurring: false, season: { start: "10-15", end: "12-31" }, starter: p(150, 425, 700), source: HG("leaf removal cost", "leaf-removal-cost"), shape: { kind: "flat" } },
  { key: "mulch-installation", name: "Mulch installation", category: "Beds & shrubs", kind: "install", isMaterial: true, description: "Fresh mulch spread in your beds, worked out from the measured bed area at 2 inches deep.", crewTask: "Install mulch", unitLabel: "per cubic yard installed", recurring: false, season: SPRING, starter: p(77, 85.5, 94), source: LS("mulch", "mulch-price", "Oct 5, 2026"), shape: { kind: "mulch" } },
  { key: "bed-weeding", name: "Bed weeding", category: "Beds & shrubs", kind: "other", description: "Hand-pulling weeds from flower and shrub beds.", crewTask: "Weed beds", unitLabel: "per sq ft of bed", recurring: false, season: null, starter: p(1.2, 1.64, 2.07), source: LS("flower bed weeding", "flower-bed-weeding-price", "Sep 9, 2026"), shape: { kind: "per_unit", quantityKey: "bed_sqft", step: 1 } },
  { key: "shrub-trimming-small", name: "Shrub trimming, 2–6 ft", category: "Beds & shrubs", kind: "other", description: "Shaping and trimming shrubs 2 to 6 feet tall, with clippings hauled away.", crewTask: "Trim shrubs (2–6 ft)", unitLabel: "per shrub", recurring: false, season: null, starter: p(5, 12.5, 20), source: HG("shrub trimming", "shrub-and-bush-trimming-cost"), shape: { kind: "per_unit", quantityKey: "each", step: 1 } },
  { key: "shrub-trimming-large", name: "Shrub trimming, over 6 ft", category: "Beds & shrubs", kind: "other", description: "Shaping and trimming shrubs over 6 feet tall, with clippings hauled away.", crewTask: "Trim shrubs (over 6 ft)", unitLabel: "per shrub", recurring: false, season: null, starter: p(10, 22.5, 35), source: HG("shrub trimming", "shrub-and-bush-trimming-cost"), shape: { kind: "per_unit", quantityKey: "each", step: 1 } },
  { key: "hedge-trimming", name: "Hedge trimming, up to 6 ft", category: "Beds & shrubs", kind: "other", description: "Trimming hedges up to 6 feet tall to a clean, even shape.", crewTask: "Trim hedges", unitLabel: "per 10 linear ft (enter feet)", recurring: false, season: null, starter: p(25, 32.5, 40), source: HG("hedge trimming", "hedge-trimming-cost"), shape: { kind: "per_unit", quantityKey: "each", step: 10 } },
  { key: "gutter-cleaning", name: "Gutter cleaning", category: "Other", kind: "other", description: "Clearing leaves and debris from gutters and checking that downspouts flow.", crewTask: "Clean gutters", unitLabel: "per linear foot (enter feet)", recurring: false, season: { start: "11-01", end: "12-15" }, starter: p(0.5, 1.5, 2.5), source: HG("gutter cleaning", "gutter-cleaning-cost"), shape: { kind: "per_unit", quantityKey: "each", step: 1 } },
  { key: "irrigation-startup", name: "Irrigation spring start-up", category: "Irrigation", kind: "irrigation", description: "Turning on your sprinkler system for the season and checking each zone.", crewTask: "Irrigation start-up", unitLabel: "per visit", recurring: false, season: { start: "04-01", end: "04-30" }, starter: p(60, 92.5, 125), source: HG("sprinkler winterization", "winterize-sprinkler-system-cost"), shape: { kind: "flat" } },
  { key: "irrigation-winterization", name: "Irrigation winterization (blowout)", category: "Irrigation", kind: "irrigation", description: "Blowing out sprinkler lines with compressed air to prevent freeze damage.", crewTask: "Irrigation blowout", unitLabel: "per visit up to 12 zones, +$7.50 per extra zone", recurring: false, season: { start: "10-20", end: "11-10" }, starter: p(50, 100, 150), source: HG("sprinkler winterization", "winterize-sprinkler-system-cost"), shape: { kind: "zones_base", baseZones: 12, perExtraZone: 7.5 } },
  { key: "snow-plowing", name: "Snow plowing, residential driveway", category: "Snow", kind: "snow", description: "Plowing your driveway after a qualifying snowfall.", crewTask: "Plow driveway", unitLabel: "per push", recurring: false, season: null, starter: p(30, 50, 70), source: HG("snow removal", "snow-removal-cost"), shape: { kind: "snow", contract: "per_push" } },
  { key: "snow-seasonal", name: "Snow, seasonal contract (limited visits)", category: "Snow", kind: "snow", description: "A flat seasonal price for driveway snow clearing, with a limited number of visits.", crewTask: "Snow contract visit", unitLabel: "flat per season", recurring: false, season: null, starter: p(200, 400, 600), source: HG("snow removal", "snow-removal-cost"), shape: { kind: "snow", contract: "seasonal_flat" } },
  { key: "sod-installation", name: "Sod installation (prepared ground)", category: "Lawn renovation", kind: "install", isMaterial: true, description: "Laying fresh sod on prepared ground for an instant lawn.", crewTask: "Install sod", unitLabel: "per sq ft installed", recurring: false, season: null, starter: p(1, 1.5, 2), source: HG("sod installation", "sod-installation-cost"), shape: { kind: "per_unit", quantityKey: "turf_sqft", step: 1 } },
  { key: "landscape-labor", name: "Landscape labor (hourly)", category: "Other", kind: "other", description: "General landscape labor for odd jobs, billed by the hour.", crewTask: "Landscape labor", unitLabel: "per hour", recurring: false, season: null, starter: p(50, 75, 100), source: HG("landscaping maintenance", "average-cost-of-landscaping-maintenance"), shape: { kind: "per_unit", quantityKey: "hours", step: 1 } },
];

export const CATALOG_SEED_V1: readonly CatalogEntry[] = DRAFTS.map((d) => ({
  ...d,
  taxable: false,
  isMaterial: d.isMaterial ?? false,
  unitQuantities: unitQuantities(d.shape),
}));

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG_SEED_V1.find((e) => e.key === key);
}
