"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { identityError, normalizeIdentity, toE164, type IdentityDraft } from "./account-format";

async function requireAccountEditor() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) {
    return fail("You don't have permission to edit customers.");
  }
  return { ok: true as const, session };
}

function noRowUpdated(): ActionResult {
  return fail("Could not save. You may not have permission, or this record changed.");
}

export async function updateAccountIdentity(id: string, values: IdentityDraft): Promise<ActionResult> {
  const gate = await requireAccountEditor();
  if (!gate.ok) return gate;
  const message = identityError(values);
  if (message) return fail(message);
  const next = normalizeIdentity(values);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({
      type: next.type,
      name: next.name,
      phone: next.phone || null,
      email: next.email || null,
    })
    .eq("id", id)
    .eq("org_id", gate.session.orgId)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return noRowUpdated();
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true };
}

export async function setAccountStatus(id: string, status: "lead" | "active" | "inactive"): Promise<ActionResult> {
  const gate = await requireAccountEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({ status })
    .eq("id", id)
    .eq("org_id", gate.session.orgId)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return noRowUpdated();
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true };
}

export async function archiveAccount(id: string): Promise<ActionResult> {
  return setAccountStatus(id, "inactive");
}

export async function findAccountMatch(
  id: string,
  phone: string,
  email: string,
): Promise<ActionResult<{ id: string; name: string } | null>> {
  const gate = await requireAccountEditor();
  if (!gate.ok) return gate;
  const parsedPhone = toE164(phone);
  const phoneValue = parsedPhone.ok ? parsedPhone.phone : null;
  const emailValue = email.trim();
  const supabase = await createClient();
  if (phoneValue) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("org_id", gate.session.orgId)
      .eq("phone", phoneValue)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (error) return fail(error.message);
    if (data) return { ok: true, data };
  }
  if (emailValue) {
    const emailQuery = supabase.from("accounts").select("id, name").eq("org_id", gate.session.orgId).neq("id", id).limit(1);
    const filtered = /[%_\\]/.test(emailValue) ? emailQuery.eq("email", emailValue) : emailQuery.ilike("email", emailValue);
    const { data, error } = await filtered.maybeSingle();
    if (error) return fail(error.message);
    if (data) return { ok: true, data };
  }
  return { ok: true, data: null };
}
