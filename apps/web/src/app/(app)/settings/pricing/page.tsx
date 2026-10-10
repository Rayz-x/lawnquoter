import type { Metadata } from "next";
import { defaultModifiers, type Modifiers } from "@lawnquoter/pricing-engine";
import { PageHeader } from "@/components/app-shell/page-header";
import { resolveEntryTab } from "@/components/entry";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PricingHeaderActions, PricingStudio } from "./pricing-studio";

export const metadata: Metadata = { title: "Services & Pricing" };

const OPEN = new Set(["draft", "sent", "viewed", "changed"]);
const TABS = ["tiers", "modifiers", "details"];

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function subtitle(list: { name: string; version: number; status: string; effective_from: string | null } | null) {
  if (!list) return "No price list yet";
  const [year, month, day] = (list.effective_from ?? "").split("-").map(Number);
  const since = year && month && day
    ? ` since ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
    : "";
  return `${list.name} price list · v${list.version} ${list.status}${since}`;
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ service?: string; tab?: string }> }) {
  const session = await requireOrg();
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data: services }, { data: lists }, { data: materials }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", session.orgId).order("sort").order("name"),
    supabase.from("price_lists").select("*").eq("org_id", session.orgId).order("version", { ascending: false }),
    supabase.from("materials").select("*").eq("org_id", session.orgId).order("name").limit(200),
  ]);
  const list = (lists ?? []).find((item) => item.status === "active") ?? (lists ?? [])[0];
  const [{ data: rules }, { data: usage }] = await Promise.all([
    list ? supabase.from("pricing_rules").select("*").eq("price_list_id", list.id).order("sort") : Promise.resolve({ data: [] }),
    supabase.from("quote_line_items").select("service_id, quote_versions(version, quotes(id, status, current_version))").eq("org_id", session.orgId).not("service_id", "is", null),
  ]);
  const modifiers = (list?.modifiers as Modifiers | null) ?? defaultModifiers();
  const openQuotes = new Map<string, Set<string>>();
  for (const row of usage ?? []) {
    const version = one(row.quote_versions);
    const quote = one(version?.quotes);
    if (!row.service_id || !quote || version?.version !== quote.current_version || !OPEN.has(quote.status)) continue;
    openQuotes.set(row.service_id, (openQuotes.get(row.service_id) ?? new Set()).add(quote.id));
  }

  return (
    <>
      <PageHeader title="Services & Pricing" description={subtitle(list ?? null)} actions={<PricingHeaderActions priceListId={list?.id ?? null} modifiers={modifiers} materials={materials ?? []} />} />
      <div className="page-body">
        <PricingStudio
          priceListId={list?.id ?? null}
          services={(services ?? []).map((item) => ({ id: item.id, name: item.name, kind: item.kind, description: item.description, active: item.active, openQuotes: openQuotes.get(item.id)?.size ?? 0 }))}
          rules={(rules ?? []).map((rule) => ({ id: rule.id, serviceId: rule.service_id, name: rule.name, config: rule.config }))}
          modifiers={modifiers}
          initialServiceId={params.service ?? null}
          initialTab={resolveEntryTab(params.tab, TABS, "tiers")}
        />
      </div>
    </>
  );
}
