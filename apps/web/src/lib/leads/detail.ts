import { hasRole, type OrgRole } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";

/** Roles that may mutate lead detail (log contact, reassign, follow-up). */
export const LEAD_EDIT_ROLES = ["owner", "admin", "sales", "dispatcher"] as const satisfies readonly OrgRole[];

export type LeadStatus = "new" | "contacted" | "quoted" | "won" | "lost" | "spam";

export type ContactChannel = "call" | "text" | "email";

/** Local contract for L01 `lead_requests` columns L09 needs. Do not invent migrations. */
export type LeadRequest = {
  id: string;
  org_id: string;
  status: LeadStatus;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  source: string | null;
  assigned_to: string | null;
  first_contacted_at: string | null;
  next_follow_up_on: string | null;
  quote_id?: string | null;
  account_id?: string | null;
  property_id?: string | null;
  created_at: string;
};

/** Local contract for L01 append-only `lead_activities`. */
export type LeadActivity = {
  id: string;
  org_id: string;
  lead_request_id: string;
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
};

export type LeadSettings = {
  default_assignee_id: string | null;
};

export type LeadActivityInsert = {
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
};

const CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: "call",
  text: "text",
  email: "email",
};

/** Keep the original first-contact timestamp; only fill when empty. */
export function nextFirstContactedAt(current: string | null, contactedAt: string): string {
  return current ?? contactedAt;
}

/** Org default assignee, else the org owner (L01 default). */
export function defaultAssigneeId(settings: LeadSettings, orgOwnerId: string): string {
  return settings.default_assignee_id ?? orgOwnerId;
}

/** Patch for a brand-new / unassigned lead. Null when already assigned. */
export function applyDefaultAssignee(
  lead: { assigned_to: string | null },
  assigneeId: string,
): { assigned_to: string } | null {
  if (lead.assigned_to) return null;
  return { assigned_to: assigneeId };
}

export function buildContactActivity(channel: ContactChannel): LeadActivityInsert {
  return {
    kind: `lead.contact.${channel}`,
    summary: `Logged ${CHANNEL_LABEL[channel]}`,
    meta: { channel },
  };
}

export function buildReassignActivity(fromName: string | null, toName: string): LeadActivityInsert {
  const from = fromName?.trim() || "Unassigned";
  return {
    kind: "lead.reassigned",
    summary: `Reassigned from ${from} to ${toName}`,
    meta: { from: fromName, to: toName },
  };
}

export function buildFollowUpActivity(nextFollowUpOn: string): LeadActivityInsert {
  return {
    kind: "lead.follow_up_set",
    summary: `Next follow-up set to ${nextFollowUpOn}`,
    meta: { next_follow_up_on: nextFollowUpOn },
  };
}

export function canViewLeads(role: OrgRole | null | undefined): boolean {
  return hasRole(role, OFFICE_ROLES);
}

export function canEditLeads(role: OrgRole | null | undefined): boolean {
  return hasRole(role, LEAD_EDIT_ROLES);
}

export function leadDisplayName(lead: Pick<LeadRequest, "contact_name" | "contact_email" | "contact_phone">): string {
  return lead.contact_name?.trim() || lead.contact_email?.trim() || lead.contact_phone?.trim() || "Lead";
}

export function leadAddressLine(
  lead: Pick<LeadRequest, "address_line1" | "city" | "region" | "postal_code">,
): string | null {
  const cityLine = [lead.city, lead.region, lead.postal_code].filter(Boolean).join(", ");
  const parts = [lead.address_line1, cityLine].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
