"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { activateSnowEvent } from "@/lib/actions/snow-activation";

export function SnowActivationCard({ date }: { date: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inches, setInches] = useState("2");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Snow event</CardTitle>
        <CardDescription>Schedule snow agreements whose trigger depth is met.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Inches
          <Input aria-label="Inches" inputMode="decimal" value={inches} onChange={(event) => setInches(event.target.value)} className="w-28" />
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
