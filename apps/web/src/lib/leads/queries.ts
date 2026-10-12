import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeLeadFilters, statusFilterValues } from "./filters";
import { leadRequests } from "./lead-table";
import type { LeadListFilters, LeadRequestListItem, LeadRequestRow } from "./types";

export type LeadListResult =
  | { ok: true; leads: LeadRequestListItem[] }
  | { ok: false; error: string };

const LIST_COLUMNS =
  "id, org_id, status, contact_name, phone, email, source, source_other, assignee_id, lost_reason, stage_entered_at, next_follow_up_on, created_at, updated_at";

export async function listLeadRequests(
  supabase: SupabaseClient<Database>,
  orgId: string,
  filters: LeadListFilters,
): Promise<LeadListResult> {
  const normalized = normalizeLeadFilters(filters);
  let query = leadRequests(supabase).select(LIST_COLUMNS).eq("org_id", orgId);

  const statuses = statusFilterValues(normalized.status);
  if (statuses) query = query.in("status", statuses);
  if (normalized.source) query = query.eq("source", normalized.source);
  if (normalized.assignee === "unassigned") query = query.is("assignee_id", null);
  else if (normalized.assignee) query = query.eq("assignee_id", normalized.assignee);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  if (error) return { ok: false, error: error.message };

  const rows = data ?? [];

  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", assigneeIds);
    for (const profile of profiles ?? []) {
      names.set(profile.id, profile.full_name ?? "Teammate");
    }
  }

  const leads: LeadRequestListItem[] = rows.map((row) => ({
    ...row,
    assignee_name: row.assignee_id ? (names.get(row.assignee_id) ?? null) : null,
  }));

  return { ok: true, leads };
}

export type CreateManualLeadInput = {
  orgId: string;
  contact_name: string;
  phone: string;
  email: string | null;
  address_typed: string;
  source: string;
  source_other: string | null;
};

export type CreateManualLeadResult =
  | { ok: true; lead: LeadRequestRow }
  | { ok: false; error: string };

export async function createManualLeadRequest(
  supabase: SupabaseClient<Database>,
  input: CreateManualLeadInput,
): Promise<CreateManualLeadResult> {
  const { data, error } = await leadRequests(supabase)
    .insert({
      org_id: input.orgId,
      status: "new",
      contact_name: input.contact_name,
      phone: input.phone,
      email: input.email,
      address_typed: input.address_typed,
      source: input.source,
      source_other: input.source_other,
    })
    .select(LIST_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Could not create lead." };
  return { ok: true, lead: data };
}

export function leadDisplayName(lead: Pick<LeadRequestRow, "contact_name" | "phone" | "email">): string {
  return lead.contact_name?.trim() || lead.phone?.trim() || lead.email?.trim() || "Untitled lead";
}
