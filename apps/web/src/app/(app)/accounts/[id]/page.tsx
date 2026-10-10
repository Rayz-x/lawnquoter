import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { FactStrip } from "@/components/entry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountHeader } from "./account-header";
import { AccountRail } from "./account-rail";
import { AccountTabBox } from "./account-tab-box";
import { ContactsPanel } from "./contacts-panel";
import { IdentityCard } from "./identity-card";
import { PropertyQuickAdd } from "./property-quick-add";

export const metadata: Metadata = { title: "Account" };

const OPEN_QUOTE_STATUSES = ["draft", "sent", "viewed", "changed"] as const;

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const session = await requireOrg();
  const supabase = await createClient();

  const [
    { data: account, error: accountError },
    { data: contacts, error: contactsError },
    { data: properties, error: propertiesError },
    { data: children, error: childrenError },
    { data: parents, error: parentsError },
    { data: activities, error: activitiesError },
    { count: openQuotes, error: quotesError },
  ] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).eq("org_id", session.orgId).maybeSingle(),
    supabase.from("contacts").select("*").eq("account_id", id).order("is_primary", { ascending: false }).order("created_at"),
    supabase
      .from("properties")
      .select(
        "id, name, formatted_address, address_line1, address_line2, city, region, postal_code, lot_sqft, building_sqft, parcel_source, is_active",
      )
      .eq("account_id", id)
      .order("created_at"),
    supabase.from("accounts").select("id, name, status").eq("parent_account_id", id).order("name"),
    supabase.from("accounts").select("id, name").eq("org_id", session.orgId).is("parent_account_id", null).eq("type", "commercial").order("name"),
    supabase
      .from("activities")
      .select("id, kind, summary, occurred_at")
      .eq("account_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id)
      .eq("org_id", session.orgId)
      .in("status", [...OPEN_QUOTE_STATUSES]),
  ]);
  const loadError =
    accountError?.message ??
    contactsError?.message ??
    propertiesError?.message ??
    childrenError?.message ??
    parentsError?.message ??
    activitiesError?.message ??
    quotesError?.message ??
    null;
  if (loadError) {
    return (
      <>
        <PageHeader title="Account" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load this account</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  if (!account) notFound();
  const { data: owner } = account.created_by
    ? await supabase.from("profiles").select("full_name").eq("id", account.created_by).maybeSingle()
    : { data: null };

  const primary = (contacts ?? []).find((contact) => contact.is_primary) ?? contacts?.[0] ?? null;
  const primaryName = [primary?.first_name, primary?.last_name].filter(Boolean).join(" ") || null;
  const showSites = account.type === "commercial" && (children?.length ?? 0) > 0;
  const allowed = ["properties", "contacts", "activity", ...(showSites ? ["sites"] : [])];
  const tabValue = tab && allowed.includes(tab) ? tab : "properties";

  return (
    <>
      <PageHeader title={account.name} />
      <div className="page-body pb-24 lg:pb-0">
        <AccountHeader account={account} primaryName={primaryName} />
        <FactStrip
          facts={[
            { label: "Open quotes", value: openQuotes ?? 0 },
            { label: "Terms", value: account.net_terms_days === 0 ? "Due" : `Net ${account.net_terms_days}` },
            {
              label: "Customer since",
              value: new Date(account.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
              detail: account.lead_source,
            },
          ]}
        />
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
        <IdentityCard account={account} />
        <AccountTabBox
          initial={tabValue}
          tabs={[
            {
              value: "properties",
              label: "Properties",
              count: properties?.length ?? 0,
              content: !properties?.length ? (
                <div className="mx-auto flex w-full max-w-[480px] flex-col">
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyTitle>No properties</EmptyTitle>
                      <EmptyDescription>Add the service address to measure and quote it.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="w-full items-stretch text-left">
                      <PropertyQuickAdd accountId={account.id} />
                    </EmptyContent>
                  </Empty>
                </div>
              ) : (
            <div className="flex flex-col gap-3">
              {properties.map((p) => (
                  <Card key={p.id}>
                    <CardHeader>
                      <CardTitle>
                        <Link href={`/properties/${p.id}`} className="hover:underline">
                          {p.name ?? p.formatted_address}
                        </Link>
                      </CardTitle>
                      <CardDescription>{p.name ? p.formatted_address : null}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="outline">Lot {p.lot_sqft ? `${Math.round(Number(p.lot_sqft)).toLocaleString()} sq ft` : "not measured"}</Badge>
                      <Badge variant="outline">
                        Building {p.building_sqft ? `${Math.round(Number(p.building_sqft)).toLocaleString()} sq ft` : "—"}
                      </Badge>
                      <Badge variant="outline">Parcel: {p.parcel_source}</Badge>
                    </CardContent>
                  </Card>
              ))}
            <PropertyQuickAdd accountId={account.id} />
            </div>
              ),
            },
            {
              value: "contacts",
              label: "Contacts",
              count: contacts?.length ?? 0,
              content: <ContactsPanel accountId={account.id} contacts={contacts ?? []} />,
            },
            ...(showSites
              ? [
                  {
                    value: "sites",
                    label: "Child accounts",
                    count: children?.length ?? 0,
                    content: (
              <Card>
                <CardHeader>
                  <CardTitle>Child accounts</CardTitle>
                  <CardDescription>Sites billed under this parent. Create them from New account and pick this parent.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {(children ?? []).map((c) => (
                    <Link key={c.id} href={`/accounts/${c.id}`} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant="outline">{c.status}</Badge>
                    </Link>
                  ))}
                  {(children ?? []).length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
                </CardContent>
              </Card>
                    ),
                  },
                ]
              : []),
            {
              value: "activity",
              label: "Activity",
              content: (
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {(activities ?? []).map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-4 text-sm">
                    <span>{a.summary}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.occurred_at).toLocaleString()}</span>
                  </div>
                ))}
                {(activities ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
              </CardContent>
            </Card>
              ),
            },
          ]}
        />
        </div>
        <AccountRail
          account={account}
          parents={parents ?? []}
          ownerName={owner?.full_name ?? "Unassigned"}
          firstProperty={
            properties?.[0]
              ? {
                  address_line1: properties[0].address_line1,
                  address_line2: properties[0].address_line2,
                  city: properties[0].city,
                  region: properties[0].region,
                  postal_code: properties[0].postal_code,
                }
              : null
          }
        />
        </div>
      </div>
    </>
  );
}
