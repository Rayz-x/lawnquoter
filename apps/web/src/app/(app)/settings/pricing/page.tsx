import type { Metadata } from "next";
import { defaultModifiers, type Modifiers } from "@lawnquoter/pricing-engine";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AddFromCatalog, CatalogDraftBanner } from "./catalog-panel";
import { openQuotesByService, type OpenQuote } from "./pricing-entry";
import { PricingHeaderActions, PricingStudio } from "./pricing-studio";

export const metadata: Metadata = { title: "Services & Pricing" };

const TABS = ["tiers", "modifiers", "details"] as const;
const pricingTab = (tab: string | null | undefined) => (TABS.includes(tab as (typeof TABS)[number]) ? tab : "tiers") as (typeof TABS)[number];

function subtitle(list: { name: string; version: number; status: string; effective_from: string | null } | null) {
  if (!list) return "No price list yet";
  const [year, month, day] = (list.effective_from ?? "").split("-").map(Number);
  const since = year && month && day ? ` since ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return `${list.name} price list · v${list.version} ${list.status}${since}`;
}

export default async function PricingPage({ searchParams }: { searchParams?: Promise<{ service?: string; tab?: string; list?: string }> } = {}) {
  const session = await requireOrg();
  const params = await (searchParams ?? Promise.resolve({ service: undefined, tab: undefined, list: undefined }));
  const supabase = await createClient();
  const [{ data: services, error: servicesError }, { data: lists, error: listsError }, { data: materials, error: materialsError }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", session.orgId).order("sort").order("name"),
    supabase.from("price_lists").select("*").eq("org_id", session.orgId).order("version", { ascending: false }),
    supabase.from("materials").select("*").eq("org_id", session.orgId).order("name").limit(200),
  ]);
  const draft = (lists ?? []).find((item) => item.status === "draft") ?? null;
  const viewingDraft = params.list === "draft" && draft != null;
  const list = viewingDraft ? draft : ((lists ?? []).find((item) => item.status === "active") ?? (lists ?? [])[0]);
  const [{ data: rules, error: rulesError }, { data: usage }, { data: draftRules }] = await Promise.all([
    list ? supabase.from("pricing_rules").select("*").eq("price_list_id", list.id).order("sort") : Promise.resolve({ data: [] as never[], error: null }),
    supabase.from("quotes").select("id, status, current_version, quote_versions(version, quote_line_items(service_id))").eq("org_id", session.orgId).in("status", ["draft", "sent", "viewed", "changed"]),
    draft ? supabase.from("pricing_rules").select("id, starter_price").eq("price_list_id", draft.id) : Promise.resolve({ data: [] as { id: string; starter_price: boolean }[] }),
  ]);
  const canEdit = hasRole(session.orgRole, ADMIN_ROLES);
  const installedKeys = (services ?? []).flatMap((item) => (item.catalog_key ? [item.catalog_key] : []));
  const loadError = servicesError?.message ?? listsError?.message ?? materialsError?.message ?? rulesError?.message;
  if (loadError) return (<><PageHeader title="Services & Pricing" description="Could not load pricing" /><div className="page-body"><p className="text-sm text-destructive">{loadError}</p></div></>);
  const modifiers = (list?.modifiers as Modifiers | null) ?? defaultModifiers();
  const openQuotes = openQuotesByService((usage ?? []) as OpenQuote[]);

  return (
    <>
      <PageHeader title="Services & Pricing" description={subtitle(list ?? null)} actions={canEdit ? <><AddFromCatalog installedKeys={installedKeys} /><PricingHeaderActions priceListId={list?.id ?? null} modifiers={modifiers} materials={materials ?? []} /></> : null} />
      <div className="page-body">
        {draft ? (
          <CatalogDraftBanner
            draftId={draft.id}
            ruleCount={(draftRules ?? []).length}
            starterCount={(draftRules ?? []).filter((rule) => rule.starter_price).length}
            viewingDraft={viewingDraft}
            canEdit={canEdit}
          />
        ) : null}
        <PricingStudio
          priceListId={list?.id ?? null}
          services={(services ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            description: item.description,
            active: item.active,
            openQuotes: openQuotes.get(item.id)?.size ?? 0,
            windowStart: item.window_start ?? null,
            windowEnd: item.window_end ?? null,
            warnDate: item.warn_date ?? null,
          }))}
          rules={(rules ?? []).map((rule) => ({ id: rule.id, serviceId: rule.service_id, name: rule.name, config: rule.config }))}
          modifiers={modifiers}
          canEdit={hasRole(session.orgRole, ADMIN_ROLES)}
          initialServiceId={params.service ?? null}
          initialTab={pricingTab(params.tab)}
        />
      </div>
    </>
  );
}
