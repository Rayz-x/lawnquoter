"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  dismissPossibleMatch,
  linkLeadToAccount,
} from "@/app/(app)/leads/[id]/match-actions";
import type { MatchCandidate } from "@/lib/leads/dedupe";

type Props = {
  leadId: string;
  candidates: MatchCandidate[];
  canEdit: boolean;
};

export function PossibleMatchBanner({ leadId, candidates, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const top = candidates[0];
  if (!top) return null;

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  };

  return (
    <Alert data-testid="possible-match-banner">
      <AlertTitle>Possible match</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Possible match: <span className="font-medium text-foreground">{top.accountName}</span>
        </span>
        {canEdit ? (
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-testid="possible-match-link"
              onClick={() =>
                run(() => linkLeadToAccount(leadId, top.accountId), "Linked to account")
              }
            >
              Link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid="possible-match-create-new"
              onClick={() =>
                run(() => dismissPossibleMatch(leadId, top.accountId), "Will create a new account")
              }
            >
              Create new
            </Button>
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
