import { ACTIVE_LEAD_STATUSES, LEAD_STATUSES, type LeadListFilters, type LeadStatus } from "./types";

export function parseLeadStatusFilter(value: string | undefined): LeadStatus | "active" | null {
  if (!value) return "active";
  if (value === "all") return null;
  if ((LEAD_STATUSES as readonly string[]).includes(value)) return value as LeadStatus;
  return "active";
}

/** Build status list for the query: default inbox hides spam. */
export function statusFilterValues(filter: LeadStatus | "active" | null): LeadStatus[] | null {
  if (filter === null) return null;
  if (filter === "active") return [...ACTIVE_LEAD_STATUSES];
  return [filter];
}

export function normalizeLeadFilters(input: LeadListFilters): {
  status: LeadStatus | "active" | null;
  source: string | null;
  assignee: string | null;
} {
  const source = input.source?.trim() || null;
  const assignee = input.assignee?.trim() || null;
  return {
    status: parseLeadStatusFilter(input.status),
    source: source === "" ? null : source,
    assignee: assignee === "" ? null : assignee,
  };
}
