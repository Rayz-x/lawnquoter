"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { identityError, normalizeIdentity, toE164, type IdentityDraft } from "./account-format";

export async function updateAccountIdentity(id: string, values: IdentityDraft): Promise<ActionResult> {
  const session = await requireOrg();
  const message = identityError(values);
  if (message) return fail(message);
  const next = normalizeIdentity(values);
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({
      type: next.type,
      name: next.name,
      phone: next.phone || null,
      email: next.email || null,
    })
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return fail(error.message);
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true };
}

export async function archiveAccount(id: string): Promise<ActionResult> {
  const session = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({ status: "inactive" })
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return fail(error.message);
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true };
}

export async function findAccountMatch(
  id: string,
  phone: string,
  email: string,
): Promise<ActionResult<{ id: string; name: string } | null>> {
  const session = await requireOrg();
  const parsedPhone = toE164(phone);
  const phoneValue = parsedPhone.ok ? parsedPhone.phone : null;
  const emailValue = email.trim();
  const supabase = await createClient();
  if (phoneValue) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("org_id", session.orgId)
      .eq("phone", phoneValue)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (error) return fail(error.message);
    if (data) return { ok: true, data };
  }
  if (emailValue) {
    const emailQuery = supabase.from("accounts").select("id, name").eq("org_id", session.orgId).neq("id", id).limit(1);
    const filtered = /[%_\\]/.test(emailValue) ? emailQuery.eq("email", emailValue) : emailQuery.ilike("email", emailValue);
    const { data, error } = await filtered.maybeSingle();
    if (error) return fail(error.message);
    if (data) return { ok: true, data };
  }
  return { ok: true, data: null };
}
