"use server";

import { revalidatePath } from "next/cache";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { markLeadLost, reopenLead } from "@/lib/leads/lost";
import { createSupabaseLeadLostStore } from "@/lib/leads/supabase-store";
import { createClient } from "@/lib/supabase/server";

function revalidateLeadPaths(leadId: string, quoteId?: string | null) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  if (quoteId) revalidatePath(`/quotes/${quoteId}`);
}

export async function markLeadLostAction(input: {
  leadId: string;
  reason: string;
  note?: string;
  quoteId?: string | null;
}): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) {
    return fail("You do not have permission to mark leads lost.");
  }

  const supabase = await createClient();
  const store = createSupabaseLeadLostStore(supabase);
  try {
    const result = await markLeadLost(store, {
      leadId: input.leadId,
      orgId: session.orgId,
      reason: input.reason,
      note: input.note,
    });
    if (!result.ok) return fail(result.error);
    revalidateLeadPaths(input.leadId, input.quoteId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark lead lost.";
    return fail(message);
  }
}

export async function reopenLeadAction(input: {
  leadId: string;
  quoteId?: string | null;
}): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) {
    return fail("You do not have permission to reopen leads.");
  }

  const supabase = await createClient();
  const store = createSupabaseLeadLostStore(supabase);
  try {
    const result = await reopenLead(store, { leadId: input.leadId, orgId: session.orgId });
    if (!result.ok) return fail(result.error);
    revalidateLeadPaths(input.leadId, input.quoteId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reopen lead.";
    return fail(message);
  }
}
