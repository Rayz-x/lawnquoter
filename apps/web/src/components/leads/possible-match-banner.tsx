"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PossibleMatchView } from "@/lib/leads/dedupe";

export type PossibleMatchBannerProps = {
  leadId: string;
  matches: PossibleMatchView[];
  canEdit: boolean;
  linkMatch: (
    leadId: string,
    accountId: string,
    propertyId: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  dismissMatch: (leadId: string, accountId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function PossibleMatchBanner({
  leadId,
  matches,
  canEdit,
  linkMatch,
  dismissMatch,
}: PossibleMatchBannerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = matches.filter((match) => !hidden.has(match.accountId));
  if (!visible.length) return null;

  const top = visible[0]!;

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
    <Alert data-testid="possible-match-banner" className="border-amber-500/40 bg-amber-500/5">
      <AlertTitle>{top.bannerText}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {top.kind === "exact_property"
            ? "Same property — link to attach this account, or create new to keep this lead separate."
            : top.kind === "same_account"
              ? "Same contact details as an existing account. Link attaches the account; nothing merges."
              : "Nearby or similar address. Link attaches the account; nothing merges."}
        </span>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-testid="possible-match-link"
              onClick={() =>
                run(() => linkMatch(leadId, top.accountId, top.propertyId), "Account linked")
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
              onClick={() => {
                run(async () => {
                  const result = await dismissMatch(leadId, top.accountId);
                  if (result.ok) setHidden((prev) => new Set(prev).add(top.accountId));
                  return result;
                }, "Kept as new");
              }}
            >
              Create new
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
