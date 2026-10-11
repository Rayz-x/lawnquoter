"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { leadsClient } from "@/lib/leads/client";
import { canEditLeads } from "@/lib/leads/detail";
import { createClient } from "@/lib/supabase/server";

const linkSchema = z.object({
  leadId: z.string().uuid(),
  accountId: z.string().uuid(),
});

function revalidateLead(id: string) {
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

/** Attach an existing account to a lead. Does not merge accounts or convert. */
export async function linkLeadToAccount(leadId: string, accountId: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!canEditLeads(session.orgRole)) return fail("You don't have permission to update leads.");

  const parsed = linkSchema.safeParse({ leadId, accountId });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", parsed.data.accountId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (accountError) return fail(accountError.message);
  if (!account) return fail("Account not found.");

  const db = leadsClient(supabase);
  const { data: leadRaw, error: leadError } = await db
    .from("lead_requests")
    .select("id, account_id")
    .eq("id", parsed.data.leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (leadError) return fail(leadError.message);
  const lead = leadRaw as { id: string; account_id: string | null } | null;
  if (!lead) return fail("Lead not found.");
  if (lead.account_id) return fail("This lead is already linked to an account.");

  const { data: updated, error: updateError } = (await db
    .from("lead_requests")
    .update({ account_id: parsed.data.accountId })
    .eq("id", parsed.data.leadId)
    .eq("org_id", session.orgId)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (updateError) return fail(updateError.message);
  if (!updated?.length) return fail("Could not link account. You may not have permission.");

  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: parsed.data.leadId,
    kind: "lead.match_linked",
    summary: `Linked to account ${account.name}`,
    meta: { account_id: parsed.data.accountId },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(parsed.data.leadId);
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  return { ok: true };
}

/** Record that the office chose Create new — banner hides for that account. */
export async function dismissPossibleMatch(leadId: string, accountId: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!canEditLeads(session.orgRole)) return fail("You don't have permission to update leads.");

  const parsed = linkSchema.safeParse({ leadId, accountId });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const db = leadsClient(supabase);
  const { data: leadRaw, error: leadError } = await db
    .from("lead_requests")
    .select("id")
    .eq("id", parsed.data.leadId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (leadError) return fail(leadError.message);
  if (!leadRaw) return fail("Lead not found.");

  const { error: activityError } = (await db.from("lead_activities").insert({
    org_id: session.orgId,
    lead_request_id: parsed.data.leadId,
    kind: "lead.match_dismissed",
    summary: "Chose create new instead of linking possible match",
    meta: { account_id: parsed.data.accountId },
    actor_id: session.userId,
  })) as { data: unknown; error: { message: string } | null };
  if (activityError) return fail(activityError.message);

  revalidateLead(parsed.data.leadId);
  return { ok: true };
}
