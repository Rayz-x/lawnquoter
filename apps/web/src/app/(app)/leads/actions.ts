"use server";

import { revalidatePath } from "next/cache";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { parseLeadSource } from "@/lib/leads/lead-source";
import { markLeadLost, reopenLead } from "@/lib/leads/lost";
import { createManualLeadRequest } from "@/lib/leads/queries";
import { createSupabaseLeadLostStore } from "@/lib/leads/supabase-store";
import { createClient } from "@/lib/supabase/server";

function revalidateLeadPaths(leadId: string, quoteId?: string | null) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  if (quoteId) revalidatePath(`/quotes/${quoteId}`);
}

export type ManualLeadActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function createManualLead(formData: FormData): Promise<ManualLeadActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) {
    return { ok: false, error: "Office sales roles can add phone leads. Read-only and crew cannot." };
  }

  const contact_name = String(formData.get("contact_name") ?? "").trim();
  const phone = String(formData.get("contact_phone") ?? "").trim();
  const email = String(formData.get("contact_email") ?? "").trim();
  const address_typed = String(formData.get("address_typed") ?? "").trim();
  const source = String(formData.get("lead_source") ?? "");
  const other = String(formData.get("lead_source_other") ?? "");

  if (!phone) {
    return { ok: false, error: "Phone is required for a manual phone lead." };
  }

  const parsed = parseLeadSource(source, other);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!parsed.lead_source) {
    return { ok: false, error: "Choose a lead source from the list." };
  }

  const supabase = await createClient();
  const result = await createManualLeadRequest(supabase, {
    orgId: session.orgId,
    contact_name: contact_name || "Phone lead",
    phone,
    email: email || null,
    address_typed: address_typed || "Phone lead — address not collected",
    source: parsed.lead_source,
    source_other: parsed.lead_source_other,
  });

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/leads");
  return { ok: true, id: result.lead.id };
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
