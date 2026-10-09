import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Agreements" };

const STATUSES = ["active", "paused", "ended"] as const;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Agreements" description="Jobs created from accepted quotes" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Agreements stay in the office. Crews see their route in the crew app.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const { status } = await searchParams;
  const statusFilter = STATUSES.find((item) => item === status);
  const supabase = await createClient();
  let query = supabase
    .from("agreements")
    .select(
      "id, kind, frequency, status, start_date, service_kind, accounts(name), properties(formatted_address, address_line1, city)",
    )
    .eq("org_id", session.orgId)
    .order("start_date", { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: agreements, error } = await query;

  return (
    <>
      <PageHeader title="Agreements" description="Jobs created from accepted quotes" />
      <div className="page-body">
        <form className="flex flex-wrap items-center gap-2">
          <NativeSelect name="status" defaultValue={statusFilter ?? ""} className="w-auto" aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </NativeSelect>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load agreements</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !agreements || agreements.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{statusFilter ? "No agreements match" : "No agreements yet"}</EmptyTitle>
              <EmptyDescription>
                {statusFilter
                  ? "Try another status, or clear the filter."
                  : "Convert an accepted quote to create the first job."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreements.map((agreement) => {
                const account = one(agreement.accounts);
                const property = one(agreement.properties);
                const address =
                  property?.formatted_address ||
                  [property?.address_line1, property?.city].filter(Boolean).join(", ") ||
                  "Address unavailable";
                return (
                  <TableRow key={agreement.id}>
                    <TableCell>
                      <Link href={`/agreements/${agreement.id}`} className="font-medium hover:underline">
                        {account?.name ?? "Account"}
                      </Link>
                      {agreement.service_kind ? (
                        <div className="text-xs text-muted-foreground capitalize">{label(agreement.service_kind)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-xs text-muted-foreground">{address}</TableCell>
                    <TableCell className="capitalize">
                      {label(agreement.kind)}
                      {agreement.frequency ? ` · ${label(agreement.frequency)}` : ""}
                    </TableCell>
                    <TableCell className="tabular-nums">{agreement.start_date}</TableCell>
                    <TableCell>
                      <Badge variant={agreement.status === "active" ? "secondary" : "outline"} className="capitalize">
                        {label(agreement.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
