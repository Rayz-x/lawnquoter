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
      <div className="mt-2 grid grid-cols-2 gap-2">
        {CREW_STATUSES.map((state) => (
          <button
            key={state}
            type="button"
            className="flex min-h-14 items-center justify-center rounded-xl border text-[17px] font-semibold disabled:opacity-50"
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
        ))}
      </div>
    </div>
  );
}
