"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reopenLeadAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  leadId: string;
  quoteId?: string | null;
};

export function ReopenLeadButton({ leadId, quoteId }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      data-testid="reopen-lead"
      onClick={() => {
        startTransition(async () => {
          const result = await reopenLeadAction({ leadId, quoteId });
          if (result.ok) {
            toast.success("Lead reopened");
            return;
          }
          toast.error(result.error);
        });
      }}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Reopen
    </Button>
  );
}
