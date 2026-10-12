"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { textOnMyWay } from "@/lib/messaging/send-on-my-way";

export function OnMyWayButton({ visitId }: { visitId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold disabled:opacity-50"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await textOnMyWay(visitId);
          if (result.ok) toast.success("On my way text sent");
          else toast.error(result.error);
        })
      }
    >
      On my way
    </button>
  );
}
