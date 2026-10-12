"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setCrewStatus } from "@/lib/actions/crew-status";
import { CREW_STATUSES, crewStatusLabel, type CrewStatus } from "@/lib/scheduling/crew-status";

export function CrewStatusForm({ visitId }: { visitId: string }) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<CrewStatus | null>(null);

  return (
    <div className="mt-4">
      <p className="text-[17px] font-semibold">Crew status</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CREW_STATUSES.map((state) => (
          <span key={state} className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold disabled:opacity-50"
            disabled={pending}
            aria-pressed={current === state}
            onClick={() => {
              startTransition(async () => {
                const result = await setCrewStatus({ visitId, state });
                if (result.ok) {
                  setCurrent(state);
                  toast.success(crewStatusLabel(state));
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {crewStatusLabel(state)}
          </button>
          </span>
        ))}
      </div>
    </div>
  );
}
