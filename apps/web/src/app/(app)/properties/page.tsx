import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireOrg();
  const { q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("properties")
    .select("id, name, formatted_address, lot_sqft, parcel_source, zone, accounts(id, name), measurements(id, status, confidence)")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) query = query.ilike("formatted_address", `%${q}%`);
  const { data: properties } = await query;

  return (
    <>
      <PageHeader title="Properties" description="Every service site, with parcel and measurement status" />
      <div className="flex flex-col gap-4 p-4">
        <form className="flex items-center gap-2">
          <Input name="q" placeholder="Search address" defaultValue={q ?? ""} className="max-w-xs" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {!properties || properties.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No properties</EmptyTitle>
              <EmptyDescription>Properties are added from an account page.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Parcel</TableHead>
                <TableHead>Measured</TableHead>
                <TableHead className="text-right">Lot sq ft</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/properties/${p.id}`} className="font-medium hover:underline">
                      {p.name ?? p.formatted_address}
                    </Link>
                    {p.name ? <div className="text-xs text-muted-foreground">{p.formatted_address}</div> : null}
                  </TableCell>
                  <TableCell>
                    {p.accounts ? (
                      <Link href={`/accounts/${p.accounts.id}`} className="hover:underline">
                        {p.accounts.name}
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.zone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.parcel_source}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.measurements?.some((m) => m.status === "current") ? (
                      <Badge>
                        {Math.round(Number(p.measurements.find((m) => m.status === "current")?.confidence ?? 0) * 100)}%
                      </Badge>
                    ) : (
                      <Badge variant="outline">Needs measure</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.lot_sqft ? Math.round(Number(p.lot_sqft)).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
