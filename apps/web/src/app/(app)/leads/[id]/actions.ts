"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import {
  applyDefaultAssignee,
  buildContactActivity,
  buildFollowUpActivity,
  buildReassignActivity,
  canEditLeads,
  defaultAssigneeId,
  nextFirstContactedAt,
  type ContactChannel,
} from "@/lib/leads/detail";
import { createClient } from "@/lib/supabase/server";

const contactSchema = z.object({
  channel: z.enum(["call", "text", "email"]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

const reassignSchema = z.object({
  assigneeId: z.string().uuid(),
});

const followUpSchema = z.object({
  nextFollowUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function requireLeadEditor() {
  const session = await requireOrg();
  if (!canEditLeads(session.orgRole)) return null;
  return session;
}

function revalidateLead(id: string) {
  revalidatePath(`/leads/${id}`);
}

export async function logLeadContact(leadId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const parsed = contactSchema.safeParse({
    channel: fd.get("channel"),
    note: fd.get("note") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: leadRaw, error: loadError } = await db
    .from("lead_requests")
    .select("id, org_id, status, first_contacted_at")
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (loadError) return fail(loadError.message);
  const lead = leadRaw as {
    id: string;
    org_id: string;
    status: string;
    first_contacted_at: string | null;
  } | null;
  if (!lead) return fail("Lead not found.");

  const contactedAt = new Date().toISOString();
  const firstContactedAt = nextFirstContactedAt(lead.first_contacted_at, contactedAt);
  const activity = buildContactActivity(parsed.data.channel as ContactChannel);
  if (parsed.data.note) activity.meta = { ...activity.meta, note: parsed.data.note };

  const patch: {
    first_contacted_at: string;
    status?: "contacted";
  } = { first_contacted_at: firstContactedAt };
  if (lead.status === "new") patch.status = "contacted";

  const { data: updatedRaw, error: updateError } = (await db
    .from("lead_requests")
    .update(patch)
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (updateError) return fail(updateError.message);
  if (!updatedRaw?.length) return fail("Could not save contact. You may not have permission.");

  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: activity.kind,
    summary: activity.summary,
    meta: activity.meta,
    actor_id: session.userId,
    occurred_at: contactedAt,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true };
}

export async function reassignLead(leadId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const parsed = reassignSchema.safeParse({ assigneeId: fd.get("assigneeId") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: leadRaw, error: loadError } = await db
    .from("lead_requests")
    .select("id, assigned_to")
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (loadError) return fail(loadError.message);
  const lead = leadRaw as { id: string; assigned_to: string | null } | null;
  if (!lead) return fail("Lead not found.");

  const ids = [lead.assigned_to, parsed.data.assigneeId].filter((id): id is string => Boolean(id));
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name?.trim() || "Teammate"]));

  const { data: updated, error: updateError } = (await db
    .from("lead_requests")
    .update({ assigned_to: parsed.data.assigneeId })
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (updateError) return fail(updateError.message);
  if (!updated?.length) return fail("Could not reassign. You may not have permission.");

  const activity = buildReassignActivity(
    lead.assigned_to ? (nameById.get(lead.assigned_to) ?? null) : null,
    nameById.get(parsed.data.assigneeId) ?? "Teammate",
  );
  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: activity.kind,
    summary: activity.summary,
    meta: { ...activity.meta, assignee_id: parsed.data.assigneeId },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true };
}

export async function setLeadFollowUp(leadId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const parsed = followUpSchema.safeParse({ nextFollowUpOn: fd.get("nextFollowUpOn") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid follow-up date");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: updated, error: updateError } = (await db
    .from("lead_requests")
    .update({ next_follow_up_on: parsed.data.nextFollowUpOn })
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (updateError) return fail(updateError.message);
  if (!updated?.length) return fail("Could not set follow-up. You may not have permission.");

  const activity = buildFollowUpActivity(parsed.data.nextFollowUpOn);
  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: activity.kind,
    summary: activity.summary,
    meta: activity.meta,
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true };
}

/**
 * Apply L01 default assignee when a lead is still unassigned.
 * Used by intake/manual create (L03/L04) and available here for backfill.
 */
export async function ensureDefaultLeadAssignee(leadId: string): Promise<ActionResult<{ assigned_to: string }>> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: leadRaw, error: loadError } = await db
    .from("lead_requests")
    .select("id, assigned_to")
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (loadError) return fail(loadError.message);
  const lead = leadRaw as { id: string; assigned_to: string | null } | null;
  if (!lead) return fail("Lead not found.");

  const { data: settingsRaw } = await db
    .from("org_lead_settings")
    .select("default_assignee_id")
    .eq("org_id", session.orgId)
    .maybeSingle();
  const settings = settingsRaw as { default_assignee_id: string | null } | null;

  const { data: owner } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("org_id", session.orgId)
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!owner?.user_id) return fail("Org owner not found for default assignment.");
  const assigneeId = defaultAssigneeId(settings ?? { default_assignee_id: null }, owner.user_id);
  const patch = applyDefaultAssignee(lead, assigneeId);
  if (!patch) return { ok: true, data: { assigned_to: lead.assigned_to as string } };

  const { data: updatedRaw, error: updateError } = await db
    .from("lead_requests")
    .update(patch)
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .select("id, assigned_to")
    .maybeSingle();
  if (updateError) return fail(updateError.message);
  const updated = updatedRaw as { id: string; assigned_to: string | null } | null;
  if (!updated) return fail("Could not assign lead.");

  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: "lead.assigned",
    summary: "Assigned to default assignee",
    meta: { assignee_id: assigneeId, reason: "default" },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true, data: { assigned_to: updated.assigned_to ?? assigneeId } };
}
