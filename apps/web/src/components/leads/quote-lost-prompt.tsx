"use client";

import { useState } from "react";
import { MarkLostDialog } from "@/components/leads/mark-lost-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { shouldPromptLostForQuote, type LeadPipelineStatus } from "@/lib/leads/lost";

type Props = {
  quoteId: string;
  quoteStatus: string;
  leadId: string;
  leadStatus: LeadPipelineStatus;
};

/** Banner + dialog when a declined/expired quote is linked to an open lead. */
export function QuoteLostPrompt({ quoteId, quoteStatus, leadId, leadStatus }: Props) {
  const [open, setOpen] = useState(false);

  if (!shouldPromptLostForQuote({ quoteStatus, leadStatus })) return null;

  const statusLabel = quoteStatus === "expired" ? "expired" : "declined";

  return (
    <div data-testid="quote-lost-prompt">
      <Alert>
        <AlertTitle>Mark this lead lost?</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>This quote {statusLabel}. Capture a lost reason on the linked lead.</span>
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
            Add lost reason
          </Button>
        </AlertDescription>
      </Alert>
      <MarkLostDialog
        leadId={leadId}
        quoteId={quoteId}
        open={open}
        onOpenChange={setOpen}
        title="Lost reason for this quote"
        description={`The quote ${statusLabel}. Choose why the lead was lost.`}
      />
    </div>
  );
}
