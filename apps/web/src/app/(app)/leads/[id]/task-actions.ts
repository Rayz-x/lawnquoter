"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import { canEditLeads } from "@/lib/leads/detail";
import { taskTitleError } from "@/lib/leads/tasks";
import { createClient } from "@/lib/supabase/server";

async function requireLeadEditor() {
  const session = await requireOrg();
  if (!canEditLeads(session.orgRole)) return null;
  return session;
}

export async function addLeadTask(leadId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const title = String(fd.get("title") ?? "");
  const titleError = taskTitleError(title);
  if (titleError) return fail(titleError);
  const dueRaw = String(fd.get("dueOn") ?? "").trim();
  const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: lead } = await db
    .from("lead_requests")
    .select("id")
    .eq("id", leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!lead) return fail("Lead not found.");

  const { error } = (await db.from("lead_tasks").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    title: title.trim(),
    due_on: dueOn,
    assignee_id: session.userId,
  })) as { error: { message: string } | null };
  if (error) return fail(error.message);

  await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: "task.added",
    summary: `Task: ${title.trim()}`,
    meta: { due_on: dueOn },
    actor_id: session.userId,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true };
}

export async function addLeadTaskForm(leadId: string, fd: FormData): Promise<void> {
  await addLeadTask(leadId, fd);
}

export async function completeLeadTask(leadId: string, taskId: string): Promise<ActionResult> {
  const session = await requireLeadEditor();
  if (!session) return fail("You don't have permission to update leads.");
  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: updated, error } = (await db
    .from("lead_tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("lead_request_id", leadId)
    .eq("org_id", session.orgId)
    .is("completed_at", null)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (error) return fail(error.message);
  if (!updated?.length) return fail("That task is already done.");

  await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: leadId,
    kind: "task.completed",
    summary: "Task completed",
    meta: { task_id: taskId },
    actor_id: session.userId,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true };
}

export async function completeLeadTaskForm(leadId: string, taskId: string): Promise<void> {
  await completeLeadTask(leadId, taskId);
}
