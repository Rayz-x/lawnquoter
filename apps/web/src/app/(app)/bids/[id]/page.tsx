import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { WalkMap } from "@/components/bids/walk-map";
import { BID_FREQUENCIES, BID_STATUSES, BID_STATUS_LABELS, packageAnnualCents, type BidFrequency } from "@/lib/bids/package";
import { SITE_WALK_PHOTO_BUCKET, walkPins } from "@/lib/bids/walk";
import { formatCents } from "@/lib/billing/review-queue";
import { createClient } from "@/lib/supabase/server";
import { addBidLine, addPortfolioSites, applyBulkMeasure, importTakeoff, setBidStatus } from "../actions";

export const metadata: Metadata = { title: "Bid package" };

export default async function BidPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const { data: pkg } = await supabase.from("bid_packages").select("*").eq("id", id).maybeSingle();
  if (!pkg) notFound();
  const [{ data: lines }, { data: sites }, { data: notes }] = await Promise.all([
    supabase.from("bid_lines").select("*").eq("package_id", id).order("sort"),
    supabase.from("bid_sites").select("id, property_id, measured_sqft").eq("package_id", id),
    supabase.from("site_walk_notes").select("id, body, lat, lng, photo_path, created_at").eq("package_id", id).order("created_at", { ascending: false }),
  ]);
  const pins = walkPins(notes ?? []);
  const photos = await Promise.all(
    (notes ?? [])
      .filter((note) => note.photo_path)
      .map(async (note) => {
        const { data } = await supabase.storage.from(SITE_WALK_PHOTO_BUCKET).createSignedUrl(note.photo_path as string, 1800);
        return [note.id, data?.signedUrl ?? null] as const;
      }),
  );
  const photoUrl = new Map(photos);
  const annual = packageAnnualCents(
    (lines ?? []).map((line) => ({
      unitPrice: Number(line.unit_price),
      qty: Number(line.qty),
      frequency: line.frequency as BidFrequency,
    })),
  );
  const canEdit = hasRole(session.orgRole, SALES_ROLES);

  return (
    <>
      <PageHeader
        title={pkg.title}
        description={`${BID_STATUS_LABELS[pkg.status]} · ${formatCents(annual)} a year`}
        actions={
          <Button variant="outline" render={<Link href="/bids" />}>
            All bids
          </Button>
        }
      />
      <div className="page-body space-y-8">
        {canEdit ? (
          <form action={setBidStatus} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="package_id" value={pkg.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Pipeline</span>
              <select name="status" defaultValue={pkg.status} className="h-9 rounded-md border bg-background px-2">
                {BID_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {BID_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              Update status
            </Button>
          </form>
        ) : null}
        <section className="space-y-2">
          <h2 className="font-heading text-lg">Spec lines</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Frequency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lines ?? []).map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell className="tabular-nums">{Number(line.qty)}</TableCell>
                  <TableCell>{line.unit}</TableCell>
                  <TableCell className="tabular-nums">{Number(line.unit_price)}</TableCell>
                  <TableCell>{line.frequency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canEdit ? (
            <form action={addBidLine} className="grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="package_id" value={pkg.id} />
              <Input name="name" required placeholder="Mowing" />
              <Input name="qty" type="number" min="0" step="0.01" defaultValue="1" />
              <Input name="unit" defaultValue="sq ft" />
              <Input name="unit_price" type="number" min="0" step="0.01" defaultValue="0" />
              <select name="frequency" className="h-9 rounded-md border bg-background px-2">
                {BID_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {frequency}
                  </option>
                ))}
              </select>
              <Button type="submit" className="sm:col-span-5 w-fit">
                Add line
              </Button>
            </form>
          ) : null}
        </section>
        <section className="space-y-2">
          <h2 className="font-heading text-lg">Sites</h2>
          <p className="text-sm text-muted-foreground">{sites?.length ?? 0} sites on this package.</p>
          {(sites ?? []).map((site) => (
            <p key={site.id} className="text-sm tabular-nums">
              {site.property_id.slice(0, 8)} · {site.measured_sqft ?? "not measured"} sq ft
            </p>
          ))}
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <form action={addPortfolioSites}>
                <input type="hidden" name="package_id" value={pkg.id} />
                <input type="hidden" name="account_id" value={pkg.account_id} />
                <Button type="submit" variant="outline">
                  Add portfolio sites
                </Button>
              </form>
              <form action={applyBulkMeasure} className="flex gap-2">
                <input type="hidden" name="package_id" value={pkg.id} />
                <Input name="sqft" type="number" min="0" placeholder="sq ft for every site" className="w-48" />
                <Button type="submit" variant="outline">
                  Bulk measure
                </Button>
              </form>
            </div>
          ) : null}
        </section>
        {canEdit ? (
          <section className="space-y-2">
            <h2 className="font-heading text-lg">Takeoff</h2>
            <form action={importTakeoff} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="package_id" value={pkg.id} />
              <Input name="file" type="file" accept=".geojson,.json,.csv,.xls,.xlsx,application/json,text/csv" required />
              <Button type="submit" variant="outline">
                Import
              </Button>
            </form>
          </section>
        ) : null}
        <section className="space-y-2">
          <h2 className="font-heading text-lg">Site walk</h2>
          <WalkMap pins={pins} />
          {(notes ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
          {(notes ?? []).map((note) => (
            <div key={note.id} className="space-y-1">
              <p className="text-sm">
                {note.body}
                {note.lat != null && note.lng != null ? ` · ${note.lat.toFixed(5)}, ${note.lng.toFixed(5)}` : ""}
              </p>
              {photoUrl.get(note.id) ? (
                // Signed storage URLs are not next/image hosts.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl.get(note.id) ?? ""} alt="" className="max-h-48 rounded-md" />
              ) : null}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
