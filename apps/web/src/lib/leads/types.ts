/**
 * App-level lead_requests shape for L03 inbox / manual entry.
 * Column names match L01 (#116) `lead_requests`.
 */

export const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Active inbox statuses — Spam is opt-in via filter, not deleted. */
export const ACTIVE_LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const satisfies readonly LeadStatus[];

export type LeadRequestRow = {
  id: string;
  org_id: string;
  status: LeadStatus;
  contact_name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  source_other: string | null;
  assignee_id: string | null;
  next_follow_up_on: string | null;
  created_at: string;
  updated_at: string;
  /** Present once the pipeline stage clock migration is applied. */
  stage_entered_at?: string | null;
  lost_reason?: string | null;
};

export type LeadRequestListItem = LeadRequestRow & {
  assignee_name: string | null;
};

export type LeadListFilters = {
  status?: string;
  source?: string;
  assignee?: string;
};
