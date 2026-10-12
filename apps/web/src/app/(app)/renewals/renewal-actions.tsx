"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proposeRenewal, saveRenewalRule } from "@/lib/actions/renewal";

export function RenewalRuleForm({ percent, windowDays }: { percent: string; windowDays: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nextPercent, setPercent] = useState(percent);
  const [nextWindow, setWindow] = useState(windowDays);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveRenewalRule({ percent: Number(nextPercent), windowDays: Number(nextWindow) });
          if (result.ok) {
            toast.success("Price increase saved");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Increase %
        <Input aria-label="Increase percent" inputMode="decimal" value={nextPercent} onChange={(event) => setPercent(event.target.value)} className="w-28" required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Days ahead
        <Input aria-label="Days ahead" inputMode="numeric" value={nextWindow} onChange={(event) => setWindow(event.target.value)} className="w-28" required />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        Save rule
      </Button>
    </form>
  );
}

export function ProposeRenewalButton({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await proposeRenewal(agreementId);
          if (result.ok) {
            toast.success("Renewal proposal created");
            router.push(`/quotes/${result.data.quoteId}`);
          } else toast.error(result.error);
        });
      }}
    >
      Propose renewal
    </Button>
  );
}
