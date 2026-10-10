"use client";

import { MarkLostDialog } from "@/components/leads/mark-lost-dialog";
import { ReopenLeadButton } from "@/components/leads/reopen-lead-button";
import type { LeadPipelineStatus } from "@/lib/leads/lost";

/** Mountable action strip for lead detail (L09) or any host that has a lead id. */
export function LeadLostActions({
  leadId,
  status,
  quoteId,
  readOnly = false,
}: {
  leadId: string;
  status: LeadPipelineStatus;
  quoteId?: string | null;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  if (status === "won" || status === "spam") return null;

  if (status === "lost") {
    return <ReopenLeadButton leadId={leadId} quoteId={quoteId} />;
  }

  return <MarkLostDialog leadId={leadId} quoteId={quoteId} />;
}
