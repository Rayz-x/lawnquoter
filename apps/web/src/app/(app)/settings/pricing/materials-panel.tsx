"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { addMaterial, importMaterialsCsv } from "./actions";

export function MaterialsPanel({
  materials,
}: {
  materials: { id: string; sku: string | null; name: string; unit: string; unit_cost: number; vendor: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Materials</CardTitle>
          <CardDescription>Used by assemblies and catalog markups. Import SiteOne / Home Depot CSVs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground">{m.sku ?? "—"}</TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{m.unit}</TableCell>
                  <TableCell className="text-right font-heading tabular-nums">{formatMoney(Number(m.unit_cost))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Add material</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  const r = await addMaterial(fd);
                  if (r.ok) toast.success("Material added");
                  else toast.error(r.error);
                });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mat_name">Name</FieldLabel>
                  <Input id="mat_name" name="name" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mat_sku">SKU</FieldLabel>
                  <Input id="mat_sku" name="sku" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field>
                    <FieldLabel htmlFor="mat_unit">Unit</FieldLabel>
                    <Input id="mat_unit" name="unit" defaultValue="each" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mat_cost">Unit cost</FieldLabel>
                    <Input id="mat_cost" name="unit_cost" type="number" step="0.01" min={0} required />
                  </Field>
                </div>
              </FieldGroup>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>CSV import</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  const r = await importMaterialsCsv(fd);
                  if (r.ok) toast.success(`Imported ${r.data.count} materials`);
                  else toast.error(r.error);
                });
              }}
            >
              <Field>
                <FieldLabel htmlFor="csv">CSV</FieldLabel>
                <Textarea id="csv" name="csv" rows={6} className="font-mono text-xs" placeholder="sku,name,unit,unit_cost" required />
                <FieldDescription>Columns: sku, name, unit, unit_cost.</FieldDescription>
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                Import
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
