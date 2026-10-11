"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { convertLeadAndOpenMeasurement } from "@/app/(app)/leads/[id]/convert-actions";

type Props = {
  leadId: string;
  disabled?: boolean;
  alreadyConverted?: boolean;
};

export function ConvertLeadButton({ leadId, disabled, alreadyConverted }: Props) {
  const [pending, startTransition] = useTransition();

  if (alreadyConverted) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="lead-already-converted">
        Already converted — open the property to continue measurement.
      </p>
    );
  }

  return (
    <Button
      type="button"
      disabled={disabled || pending}
      data-testid="lead-convert"
      onClick={() => {
        startTransition(async () => {
          const result = await convertLeadAndOpenMeasurement(leadId);
          if (result && !result.ok) toast.error(result.error);
        });
      }}
    >
      {pending ? "Converting…" : "Convert to quote"}
    </Button>
  );
}
