"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/help/help-tip";
import { activateSnowEvent } from "@/lib/actions/snow-activation";

export function SnowActivationCard({ date }: { date: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inches, setInches] = useState("2");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Snow event
          <HelpTip
            label="Help for snow events"
            text="Agreements at or under this depth get a visit. One visit is scheduled for each agreement that is not already on this day."
            href="/help/snow#activate-a-snow-day"
          />
        </CardTitle>
        <CardDescription>Schedule snow agreements whose trigger depth is met.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex min-w-0 max-w-40 flex-col gap-1 text-sm">
          <span className="inline-flex items-center gap-1">
            Inches
            <HelpTip
              label="Help for snow depth"
              text="How much snow fell. Agreements at or under this depth get a visit."
              href="/help/snow#activate-a-snow-day"
            />
          </span>
          <Input aria-label="Inches" inputMode="decimal" value={inches} onChange={(event) => setInches(event.target.value)} className="w-full" />
        </label>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await activateSnowEvent({ eventDate: date, inches: Number(inches) });
              if (result.ok) {
                toast.success(result.data.created === 0 ? "No new snow visits" : `Scheduled ${result.data.created} snow visits`);
                router.refresh();
              } else toast.error(result.error);
            });
          }}
        >
          Activate snow
        </Button>
      </CardContent>
    </Card>
  );
}
