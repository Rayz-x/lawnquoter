"use server";

import { revalidatePath } from "next/cache";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { parseTemplateDraft } from "@/lib/messaging/template";
import { createClient } from "@/lib/supabase/server";

const DENIED = "Only sales can edit message templates.";

function plainError(error: { message: string; code?: string }) {
  return error.code === "23505" ? "That channel and purpose already has a default template." : error.message;
}

export async function saveMessageTemplate(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail(DENIED);
  const parsed = parseTemplateDraft({
    name: String(fd.get("name") ?? ""),
    channel: String(fd.get("channel") ?? ""),
    purpose: String(fd.get("purpose") ?? ""),
    subject: String(fd.get("subject") ?? ""),
    body: String(fd.get("body") ?? ""),
    isDefault: fd.get("is_default") === "true",
  });
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  if (parsed.value.isDefault) {
    const cleared = await supabase.from("message_templates").update({ is_default: false }).eq("org_id", session.orgId).eq("channel", parsed.value.channel).eq("purpose", parsed.value.purpose).eq("is_default", true);
    if (cleared.error) return fail(plainError(cleared.error));
  }
  const row = {
    name: parsed.value.name,
    channel: parsed.value.channel,
    purpose: parsed.value.purpose,
    subject: parsed.value.subject,
    body: parsed.value.body,
    is_default: parsed.value.isDefault,
  };
  const id = String(fd.get("id") ?? "");
  const saved = id
    ? await supabase.from("message_templates").update(row).eq("id", id).eq("org_id", session.orgId).select("id").maybeSingle()
    : await supabase.from("message_templates").insert({ ...row, org_id: session.orgId }).select("id").single();
  if (saved.error) return fail(plainError(saved.error));
  if (!saved.data) return fail("Template not found.");
  revalidatePath("/settings/messages");
  return { ok: true, data: { id: saved.data.id } };
}

export async function deleteMessageTemplate(id: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail(DENIED);
  const supabase = await createClient();
  const { data, error } = await supabase.from("message_templates").delete().eq("id", id).eq("org_id", session.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Template not found.");
  revalidatePath("/settings/messages");
  return { ok: true };
}
