"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import {
  buildContactActivity,
  buildFollowUpActivity,
  buildReassignActivity,
  canEditLeads,
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

const linkMatchSchema = z.object({
  accountId: z.string().uuid(),
  propertyId: z.string().uuid().nullable().optional(),
});

const dismissMatchSchema = z.object({
  accountId: z.string().uuid(),
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

/** Attach an existing account (and optional property). Never merges accounts. */
export async function linkLeadMatch(
  leadId: string,
  accountId: string,
  propertyId: string | null,
): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const parsed = linkMatchSchema.safeParse({ accountId, propertyId: propertyId ?? null });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid match");

  const supabase = await createClient();
  const db = leadsClient(supabase);

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", parsed.data.accountId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (accountError) return fail(accountError.message);
  if (!account) return fail("Account not found.");

  if (parsed.data.propertyId) {
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id")
      .eq("id", parsed.data.propertyId)
      .eq("org_id", session.orgId)
      .eq("account_id", parsed.data.accountId)
      .maybeSingle();
    if (propertyError) return fail(propertyError.message);
    if (!property) return fail("Property not found on that account.");
  }

  const { data: updated, error: updateError } = (await db
    .from("lead_requests")
    .update({
      account_id: parsed.data.accountId,
      property_id: parsed.data.propertyId ?? null,
    })
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (updateError) return fail(updateError.message);
  if (!updated?.length) return fail("Could not link account.");

  const accountName = (account as { name: string | null }).name?.trim() || "Account";
  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: "match_linked",
    summary: `Linked to ${accountName}`,
    meta: {
      account_id: parsed.data.accountId,
      property_id: parsed.data.propertyId ?? null,
    },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true };
}

/** Keep lead unlinked (Create new) — records dismissal; does not merge. */
export async function dismissLeadMatch(leadId: string, accountId: string): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const parsed = dismissMatchSchema.safeParse({ accountId });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid account");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: lead, error: loadError } = await db
    .from("lead_requests")
    .select("id")
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (loadError) return fail(loadError.message);
  if (!lead) return fail("Lead not found.");

  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: "match_dismissed",
    summary: "Kept lead as new (did not link possible match)",
    meta: { account_id: parsed.data.accountId },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(leadId);
  return { ok: true };
}
