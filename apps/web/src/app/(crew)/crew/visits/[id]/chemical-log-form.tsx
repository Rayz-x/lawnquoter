"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logChemicalApplication } from "@/lib/actions/chemical-log";

export function ChemicalLogForm({ visitId }: { visitId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [product, setProduct] = useState("");
  const [rate, setRate] = useState("");
  const [epa, setEpa] = useState("");
  const [temp, setTemp] = useState("");
  const [wind, setWind] = useState("");
  const [conditions, setConditions] = useState("");

  if (!open) {
    return (
      <Button type="button" variant="outline" size="lg" className="mt-4 h-12 w-full text-lg" onClick={() => setOpen(true)}>
        Log a chemical application
      </Button>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-2 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await logChemicalApplication({
            visitId,
            product,
            rate,
            epaRegNo: epa,
            tempF: Number(temp),
            windMph: Number(wind),
            conditions,
          });
          if (result.ok) {
            toast.success("Chemical application logged");
            setProduct("");
            setRate("");
            setEpa("");
            setTemp("");
            setWind("");
            setConditions("");
            setOpen(false);
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <h2 className="font-serif text-xl font-bold">Chemical application</h2>
      <Input aria-label="Product" placeholder="Product" value={product} onChange={(event) => setProduct(event.target.value)} required className="h-12 text-lg" />
      <Input aria-label="Rate" placeholder="Rate" value={rate} onChange={(event) => setRate(event.target.value)} required className="h-12 text-lg" />
      <Input aria-label="EPA registration number" placeholder="EPA reg. no." value={epa} onChange={(event) => setEpa(event.target.value)} required className="h-12 text-lg" />
      <Input aria-label="Temperature" placeholder="Temperature °F" inputMode="decimal" value={temp} onChange={(event) => setTemp(event.target.value)} required className="h-12 text-lg" />
      <Input aria-label="Wind" placeholder="Wind mph" inputMode="decimal" value={wind} onChange={(event) => setWind(event.target.value)} required className="h-12 text-lg" />
      <Input aria-label="Weather" placeholder="Weather" value={conditions} onChange={(event) => setConditions(event.target.value)} className="h-12 text-lg" />
      <Button type="submit" variant="secondary" size="lg" className="h-12 text-lg" disabled={pending}>
        Save application
      </Button>
    </form>
  );
}
