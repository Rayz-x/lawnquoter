import type { Metadata } from "next";
import { defaultModifiers, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MaterialsPanel } from "./materials-panel";
import { ModifiersForm } from "./modifiers-form";
import { PreviewCard } from "./preview-card";
import { RuleForm } from "./rule-form";
import { ServiceForm } from "./service-form";

export const metadata: Metadata = { title: "Services & Pricing" };

export default async function PricingPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const [{ data: services }, { data: lists }, { data: materials }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", session.orgId).order("sort").order("name"),
    supabase.from("price_lists").select("*").eq("org_id", session.orgId).order("version", { ascending: false }),
    supabase.from("materials").select("*").eq("org_id", session.orgId).order("name").limit(200),
  ]);
  const list = (lists ?? []).find((l) => l.status === "active") ?? (lists ?? [])[0];
  const { data: rules } = list
    ? await supabase.from("pricing_rules").select("*").eq("price_list_id", list.id).order("sort")
    : { data: [] };

  const modifiers = (list?.modifiers as Modifiers | null) ?? defaultModifiers();

  return (
    <>
      <PageHeader
        title="Services & Pricing"
        description="One price list for the company. Every rule returns price, hours, and cost."
      />
      <div className="page-body">
        <Tabs defaultValue="services">
          <TabsList>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="modifiers">Modifiers</TabsTrigger>
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="services" className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-2">
              {(services ?? []).map((s) => (
                <Card key={s.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {s.name}
                      <Badge variant="outline" className="capitalize">
                        {s.kind}
                      </Badge>
                      {!s.active ? <Badge variant="secondary">Off</Badge> : null}
                    </CardTitle>
                    <CardDescription>{s.description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
              {(services ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Add weekly mow, fert, snow…</p> : null}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Add service</CardTitle>
                <CardDescription>Mowing services get a starter rate matrix you can edit.</CardDescription>
              </CardHeader>
              <CardContent>
                <ServiceForm />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules" className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-2">
              {(rules ?? []).map((r) => (
                <Card key={r.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {r.name}
                      <Badge variant="outline">{r.rule_type}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {(services ?? []).find((s) => s.id === r.service_id)?.name ?? "Service"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RuleForm
                      priceListId={list?.id ?? ""}
                      services={services ?? []}
                      rule={{
                        id: r.id,
                        service_id: r.service_id,
                        name: r.name,
                        config: JSON.stringify(r.config, null, 2),
                      }}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>New rule</CardTitle>
                <CardDescription>Tier matrix, assembly, catalog, program, snow, or irrigation.</CardDescription>
              </CardHeader>
              <CardContent>
                {list ? <RuleForm priceListId={list.id} services={services ?? []} /> : <p className="text-sm text-muted-foreground">No price list yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="modifiers">
            {list ? (
              <ModifiersForm priceListId={list.id} modifiers={modifiers} />
            ) : (
              <p className="text-sm text-muted-foreground">No price list.</p>
            )}
          </TabsContent>

          <TabsContent value="materials">
            <MaterialsPanel materials={materials ?? []} />
          </TabsContent>

          <TabsContent value="preview">
            <PreviewCard
              rules={(rules ?? []).flatMap((r) => {
                const parsed = r.config as PricingRule;
                return parsed?.type ? [{ name: r.name, rule: parsed }] : [];
              })}
              modifiers={modifiers}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
