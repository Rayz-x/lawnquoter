"use client";

import { useState } from "react";
import { toast } from "sonner";
import { correctionPayload, fromLocalInputValue, reasonOk, toLocalInputValue } from "@/lib/crew/time-correction";
import { browserCrewStore, enqueueMutation, flushOutbox, saveDayPack } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";
import { patchVisitPack, visitFromPack } from "../visit";
import type { Json } from "@/lib/supabase/database.types";

export function VisitTimeCorrect({
  visitId,
  userId,
  orgId,
  startedAt,
  completedAt,
}: {
  visitId: string;
  userId: string;
  orgId: string;
  startedAt: string | null;
  completedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => toLocalInputValue(startedAt));
  const [finish, setFinish] = useState(() => toLocalInputValue(completedAt));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const payload = correctionPayload({
      startedAt: fromLocalInputValue(start),
      completedAt: fromLocalInputValue(finish),
      reason,
    });
    if (!payload || busy) {
      setError(!reasonOk(reason) ? "A reason is required." : "Check the start and finish times.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const store = browserCrewStore();
      await enqueueMutation(store, {
        kind: "visit_correct_times",
        visit_id: visitId,
        user_id: userId,
        org_id: orgId,
        payload,
      });
      const packs = await store.listPacks();
      const row = packs.find((pack) => visitFromPack(pack.pack, visitId));
      if (row) {
        await saveDayPack(
          store,
          row.date,
          patchVisitPack(row.pack, visitId, {
            started_at: payload.started_at,
            completed_at: payload.completed_at,
          }) as Json,
        );
      }
      void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
      window.dispatchEvent(new Event("crew-pack"));
      toast("Time correction saved. It sends when you have signal.");
      setOpen(false);
      setReason("");
    } catch {
      setError("Could not save that correction.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold"
        onClick={() => {
          setStart(toLocalInputValue(startedAt));
          setFinish(toLocalInputValue(completedAt));
          setOpen(true);
          setError(null);
        }}
      >
        Correct times
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-8">
      <button type="button" className="inline-flex min-h-12 items-center text-[17px] font-semibold" onClick={() => setOpen(false)}>
        Back
      </button>
      <h2 className="mt-2 font-serif text-2xl font-bold">Correct times</h2>
      <p className="mt-2 text-[15px] text-muted-foreground">
        Device times stay on file. Tell the office why you changed start or finish.
      </p>
      <label className="mt-4 block text-[15px] font-semibold">
        Start
        <input
          type="datetime-local"
          className="mt-1 flex min-h-14 w-full rounded-xl border px-3 text-[17px]"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </label>
      <label className="mt-3 block text-[15px] font-semibold">
        Finish
        <input
          type="datetime-local"
          className="mt-1 flex min-h-14 w-full rounded-xl border px-3 text-[17px]"
          value={finish}
          onChange={(event) => setFinish(event.target.value)}
        />
      </label>
      <label className="mt-3 block text-[15px] font-semibold">
        Reason
        <textarea
          className="mt-1 min-h-28 w-full rounded-xl border px-3 py-3 text-[17px]"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are these times different?"
          maxLength={2000}
        />
      </label>
      {error ? <p className="mt-3 text-[15px] font-semibold text-destructive">{error}</p> : null}
      <button
        type="button"
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50"
        disabled={busy || !reasonOk(reason)}
        onClick={() => void save()}
      >
        Save correction
      </button>
    </div>
  );
}
