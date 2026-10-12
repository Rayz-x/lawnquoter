"use server";

import { revalidatePath } from "next/cache";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { createEmailProvider } from "@/lib/email/provider";
import { portalExpiresAt } from "@/lib/portal/scope";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function createPortalLink(formData: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) throw new Error("Sales can send a customer portal link.");
  const accountId = String(formData.get("account_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@") || email.length > 200) throw new Error("Enter the customer's email.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portal_links")
    .insert({
      org_id: session.orgId,
      account_id: accountId,
      email,
      expires_at: portalExpiresAt(new Date()).toISOString(),
      created_by: session.userId,
    })
    .select("token")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the portal link.");
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const url = `${origin}/portal/${data.token}`;
  try {
    await createEmailProvider().send({
      to: email,
      subject: "Your customer portal",
      text: `Open your portal: ${url}`,
    });
  } catch {
    // The account page still shows the link when mail is not configured.
  }
  revalidatePath(`/accounts/${accountId}`);
}
