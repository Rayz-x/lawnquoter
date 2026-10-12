"use server";

import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { createSendingDomain, parseSendingDomain, RESEND_NOT_CONNECTED, resendApiKey } from "@/lib/email/sending-domain";

export async function addSendingDomain(formData: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) redirect("/settings/sending?error=Only an owner or admin can add a domain");
  const name = parseSendingDomain(String(formData.get("domain") ?? ""));
  if (!name) redirect("/settings/sending?error=Enter a domain such as mail.example.com");
  const key = resendApiKey(process.env);
  if (!key) redirect(`/settings/sending?error=${encodeURIComponent(RESEND_NOT_CONNECTED)}`);
  const result = await createSendingDomain(key, name, (url, init) => fetch(url, init));
  if (!result.ok) redirect(`/settings/sending?error=${encodeURIComponent(result.error)}`);
  revalidatePath("/settings/sending");
  redirect("/settings/sending");
}
