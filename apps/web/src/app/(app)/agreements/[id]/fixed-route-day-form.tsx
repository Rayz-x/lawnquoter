"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ToggleRow } from "@/components/entry";
import { setFixedRouteDay } from "@/lib/actions/route-day";

export function FixedRouteDayForm({
  agreementId,
  fixed,
  weekday,
}: {
  agreementId: string;
  fixed: boolean;
  weekday: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <ToggleRow
      label="Fixed route day"
      description={
        weekday
          ? `Stays on ${weekday}. Rain day moves it to the next ${weekday}.`
          : "Pick a preferred day first."
      }
      checked={fixed}
      disabled={pending || weekday == null}
      onCheckedChange={(checked) => {
        startTransition(async () => {
          const result = await setFixedRouteDay(agreementId, checked);
          if (result.ok) {
            toast.success(checked ? `Locked to ${weekday}` : "Route day unlocked");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    />
  );
}
