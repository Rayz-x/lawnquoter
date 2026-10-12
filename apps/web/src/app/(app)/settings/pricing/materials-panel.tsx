"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { addMaterial, importMaterialsCsv } from "./actions";

const MATERIAL_UNITS = [
  ["each", "Each"],
  ["bag", "Bag"],
  ["cubic yard", "Cubic yard"],
  ["ton", "Ton"],
  ["pallet", "Pallet"],
  ["gallon", "Gallon"],
  ["pound", "Pound"],
  ["sq ft", "Square foot"],
  ["linear ft", "Linear foot"],
  ["hour", "Hour"],
] as const;

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
          <CardDescription>What your materials cost you, used to work out your margins. You can upload a spreadsheet from SiteOne or Home Depot.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item #</TableHead>
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
                  <FieldLabel htmlFor="mat_sku">Item number (optional)</FieldLabel>
                  <Input id="mat_sku" name="sku" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field>
                    <FieldLabel htmlFor="mat_unit">Sold by the</FieldLabel>
                    <select id="mat_unit" name="unit" className="native-control" defaultValue="each">
                      {MATERIAL_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mat_cost">Your cost ($)</FieldLabel>
                    <Input id="mat_cost" name="unit_cost" type="number" inputMode="decimal" step="0.01" min={0} placeholder="0.00" required />
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
            <CardTitle>Import from a spreadsheet</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const file = (e.currentTarget.elements.namedItem("sheet") as HTMLInputElement | null)?.files?.[0];
                if (!file) return;
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("csv", await file.text());
                  const r = await importMaterialsCsv(fd);
                  if (r.ok) toast.success(`Imported ${r.data.count} materials`);
                  else toast.error(r.error);
                });
              }}
            >
              <Field>
                <FieldLabel htmlFor="sheet">Spreadsheet file (.csv)</FieldLabel>
                <Input id="sheet" name="sheet" type="file" accept=".csv,text/csv" required />
                <FieldDescription>Save your sheet as CSV. First row: Item number, Name, Unit, Cost. Example row: MUL-1, Brown mulch, cubic yard, 32.00</FieldDescription>
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                Import materials
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
