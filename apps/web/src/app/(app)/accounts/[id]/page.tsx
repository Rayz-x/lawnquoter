import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "../account-form";
import { ContactsPanel } from "./contacts-panel";
import { PropertyForm } from "./property-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  const supabase = await createClient();

  const [{ data: account }, { data: contacts }, { data: properties }, { data: children }, { data: parents }, { data: activities }] =
    await Promise.all([
      supabase.from("accounts").select("*").eq("id", id).eq("org_id", session.orgId).single(),
      supabase.from("contacts").select("*").eq("account_id", id).order("is_primary", { ascending: false }).order("created_at"),
      supabase
        .from("properties")
        .select("id, name, formatted_address, lot_sqft, building_sqft, parcel_source, is_active")
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
    ]);
  if (!account) notFound();

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${account.type === "commercial" ? "Commercial" : "Residential"} · ${account.status}`}
        actions={
          <Button variant="outline" render={<Link href={`/quotes/new?account=${account.id}`} />}>
            New quote
          </Button>
        }
      />
      <div className="page-body">
        <Tabs defaultValue="properties">
          <TabsList>
            <TabsTrigger value="properties">Properties ({properties?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts ({contacts?.length ?? 0})</TabsTrigger>
            {account.type === "commercial" ? <TabsTrigger value="sites">Child accounts ({children?.length ?? 0})</TabsTrigger> : null}
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
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

          <TabsContent value="details">
            <Card className="max-w-2xl">
              <CardContent className="pt-6">
                <AccountForm account={account} parents={parents ?? []} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
