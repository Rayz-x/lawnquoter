"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FieldHint } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chemicalLog } from "@/lib/crew/chemical-log";
import { browserCrewStore, enqueueMutation, flushOutbox } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";

export function ChemicalLogForm({ visitId, userId, orgId, startOpen = false }: { visitId: string; userId: string; orgId: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [pending, setPending] = useState(false);
  const [product, setProduct] = useState("");
  const [rate, setRate] = useState("");
  const [epa, setEpa] = useState("");
  const [temp, setTemp] = useState("");
  const [wind, setWind] = useState("");
  const [conditions, setConditions] = useState("");

  if (!open) {
    return (
      <span className="mt-4 flex min-w-0 flex-col gap-1">
        <Button type="button" variant="outline" size="lg" className="h-12 w-full text-lg" onClick={() => setOpen(true)}>
          Log a chemical application
        </Button>
        <FieldHint>Records the product, rate, EPA number, and the weather. It sends when you have signal.</FieldHint>
      </span>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-2 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = chemicalLog({
          product,
          rate,
          epaRegNo: epa,
          tempF: Number(temp),
          windMph: Number(wind),
          conditions,
        });
        if (!parsed.ok) {
          toast.error(parsed.error);
          return;
        }
        const log = parsed.log;
        setPending(true);
        void (async () => {
          try {
            const store = browserCrewStore();
            await enqueueMutation(store, {
              kind: "visit_log_chemical",
              visit_id: visitId,
              user_id: userId,
              org_id: orgId,
              payload: {
                product: log.product,
                rate: log.rate,
                epa_reg_no: log.epaRegNo,
                temp_f: log.tempF,
                wind_mph: log.windMph,
                conditions: log.conditions || null,
              },
            });
            void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
            toast("Chemical application saved. It sends when you have signal.");
            setProduct("");
            setRate("");
            setEpa("");
            setTemp("");
            setWind("");
            setConditions("");
            setOpen(false);
          } catch {
            toast.error("Could not save that chemical application.");
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <h2 className="font-serif text-xl font-bold">Chemical application</h2>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="Product" placeholder="Product" value={product} onChange={(event) => setProduct(event.target.value)} required className="h-12 text-lg" />
        <FieldHint>The product you applied.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="Rate" placeholder="Rate" value={rate} onChange={(event) => setRate(event.target.value)} required className="h-12 text-lg" />
        <FieldHint>How much you applied, such as ounces per thousand square feet.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="EPA registration number" placeholder="EPA reg. no." value={epa} onChange={(event) => setEpa(event.target.value)} required className="h-12 text-lg" />
        <FieldHint>The EPA registration number on the label.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="Temperature" placeholder="Temperature °F" inputMode="decimal" value={temp} onChange={(event) => setTemp(event.target.value)} required className="h-12 text-lg" />
        <FieldHint>Air temperature while you sprayed, in degrees Fahrenheit.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="Wind" placeholder="Wind mph" inputMode="decimal" value={wind} onChange={(event) => setWind(event.target.value)} required className="h-12 text-lg" />
        <FieldHint>Wind speed while you sprayed, in miles per hour.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <Input aria-label="Weather" placeholder="Weather" value={conditions} onChange={(event) => setConditions(event.target.value)} className="h-12 text-lg" />
        <FieldHint>Sky and ground conditions, such as clear or wet grass.</FieldHint>
      </label>
      <span className="flex min-w-0 flex-col gap-1">
        <Button type="submit" variant="secondary" size="lg" className="h-12 text-lg" disabled={pending}>
          Save application
        </Button>
        <FieldHint>Saves the log on the phone and sends it when you have signal.</FieldHint>
      </span>
    </form>
  );
}
