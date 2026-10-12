"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FieldHint } from "@/components/entry";
import { irrigationZoneNote } from "@/lib/crew/irrigation-zone-note";
import { browserCrewStore, enqueueMutation, flushOutbox } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";

export function IrrigationZoneForm({ visitId, userId, orgId, startOpen = false }: { visitId: string; userId: string; orgId: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [pending, setPending] = useState(false);
  const [zone, setZone] = useState("1");
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <span className="mt-4 flex min-w-0 flex-col gap-1">
        <button type="button" className="flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => setOpen(true)}>
          Add an irrigation zone note
        </button>
        <FieldHint>Writes what you found on one zone. It sends when you have signal.</FieldHint>
      </span>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-2 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = irrigationZoneNote({ zone: Number(zone), note });
        if (!parsed.ok) {
          toast.error(parsed.error);
          return;
        }
        setPending(true);
        void (async () => {
          try {
            const store = browserCrewStore();
            await enqueueMutation(store, {
              kind: "visit_log_irrigation",
              visit_id: visitId,
              user_id: userId,
              org_id: orgId,
              payload: { zone_number: parsed.note.zone, note: parsed.note.note },
            });
            void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
            toast("Zone note saved. It sends when you have signal.");
            setNote("");
            setOpen(false);
          } catch {
            toast.error("Could not save that zone note.");
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <h2 className="font-serif text-xl font-bold">Irrigation zone</h2>
      <label className="flex min-w-0 flex-col gap-1 text-[15px]">
        Zone
        <input aria-label="Zone" placeholder="Zone" inputMode="numeric" value={zone} onChange={(event) => setZone(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
        <FieldHint>The zone number on the controller.</FieldHint>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[15px]">
        Note
        <input aria-label="Note" placeholder="What you found" value={note} onChange={(event) => setNote(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
        <FieldHint>What you found, such as a broken head or a dry zone.</FieldHint>
      </label>
      <span className="flex min-w-0 flex-col gap-1">
        <button type="submit" className="flex min-h-14 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={pending}>
          Save zone note
        </button>
        <FieldHint>Saves the note on the phone and sends it when you have signal.</FieldHint>
      </span>
    </form>
  );
}
