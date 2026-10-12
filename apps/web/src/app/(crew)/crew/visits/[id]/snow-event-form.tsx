"use client";

import { useState } from "react";
import { toast } from "sonner";
import { browserCrewStore, enqueueMutation, flushOutbox } from "@/lib/crew/queue";
import { snowEventLog } from "@/lib/crew/snow-event-log";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";

export function SnowEventForm({ visitId, userId, orgId }: { visitId: string; userId: string; orgId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [trigger, setTrigger] = useState("2");
  const [started, setStarted] = useState("");
  const [ended, setEnded] = useState("");
  const [materials, setMaterials] = useState("");

  if (!open) {
    return (
      <button type="button" className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => setOpen(true)}>
        Log a snow event
      </button>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-2 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = snowEventLog({
          triggerIn: Number(trigger),
          startedAt: started,
          endedAt: ended,
          materials,
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
              kind: "visit_log_snow",
              visit_id: visitId,
              user_id: userId,
              org_id: orgId,
              payload: {
                trigger_depth_in: log.triggerIn,
                started_at: log.startedAt,
                ended_at: log.endedAt,
                materials: log.materials,
              },
            });
            void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
            toast("Snow event saved. It sends when you have signal.");
            setMaterials("");
            setOpen(false);
          } catch {
            toast.error("Could not save that snow event.");
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <h2 className="font-serif text-xl font-bold">Snow event</h2>
      <input aria-label="Trigger depth" placeholder="Trigger inches" inputMode="decimal" value={trigger} onChange={(event) => setTrigger(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
      <input aria-label="Started" type="datetime-local" value={started} onChange={(event) => setStarted(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
      <input aria-label="Ended" type="datetime-local" value={ended} onChange={(event) => setEnded(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
      <input aria-label="Materials" placeholder="Materials" value={materials} onChange={(event) => setMaterials(event.target.value)} required className="h-12 rounded-md border px-3 text-[17px]" />
      <button type="submit" className="flex min-h-14 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={pending}>
        Save snow event
      </button>
    </form>
  );
}
