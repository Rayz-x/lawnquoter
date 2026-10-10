import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { FactStrip } from "@/components/entry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountHeader } from "./account-header";
import { ContactsPanel } from "./contacts-panel";
import { IdentityCard } from "./identity-card";
import { PropertyForm } from "./property-form";

export const metadata: Metadata = { title: "Account" };

const ACCOUNT_TABS = ["properties", "contacts", "sites", "activity"];
const OPEN_QUOTE_STATUSES = ["draft", "sent", "viewed", "changed"] as const;

function termsLabel(days: number) {
  return days === 0 ? "Due" : `Net ${days}`;
}

function customerSince(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

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
    { data: activities, error: activitiesError },
    { count: openQuotes, error: quotesError },
  ] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).eq("org_id", session.orgId).maybeSingle(),
    supabase.from("contacts").select("*").eq("account_id", id).order("is_primary", { ascending: false }).order("created_at"),
    supabase
      .from("properties")
      .select("id, name, formatted_address, lot_sqft, building_sqft, parcel_source, is_active")
      .eq("account_id", id)
      .order("created_at"),
    supabase.from("accounts").select("id, name, status").eq("parent_account_id", id).order("name"),
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

  const primary = (contacts ?? []).find((contact) => contact.is_primary) ?? contacts?.[0] ?? null;
  const primaryName = [primary?.first_name, primary?.last_name].filter(Boolean).join(" ") || null;
  const tabValue = tab && ACCOUNT_TABS.includes(tab) && (tab !== "sites" || account.type === "commercial") ? tab : "properties";

  return (
    <>
      <PageHeader title={account.name} />
      <div className="page-body">
        <AccountHeader account={account} primaryName={primaryName} />
        <FactStrip
          facts={[
            { label: "Annual value", value: "—" },
            { label: "Open quotes", value: openQuotes ?? 0 },
            { label: "Terms", value: termsLabel(account.net_terms_days) },
            { label: "Balance", value: "—" },
            { label: "Customer since", value: customerSince(account.created_at), detail: account.lead_source },
          ]}
        />
        <IdentityCard account={account} />
        <Tabs key={tabValue} defaultValue={tabValue}>
          <TabsList>
            <TabsTrigger value="properties">Properties ({properties?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts ({contacts?.length ?? 0})</TabsTrigger>
            {account.type === "commercial" ? <TabsTrigger value="sites">Child accounts ({children?.length ?? 0})</TabsTrigger> : null}
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="properties" className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-2">
              {!properties || properties.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No properties</EmptyTitle>
                    <EmptyDescription>Add the service address to measure and quote it.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                properties.map((p) => (
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
                ))
              )}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Add property</CardTitle>
                <CardDescription>We geocode it and pull the parcel and building footprint automatically.</CardDescription>
              </CardHeader>
              <CardContent>
                <PropertyForm accountId={account.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts">
            <ContactsPanel accountId={account.id} contacts={contacts ?? []} />
          </TabsContent>

          {account.type === "commercial" ? (
            <TabsContent value="sites">
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
            </TabsContent>
          ) : null}

          <TabsContent value="activity">
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
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
