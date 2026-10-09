"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/actions/result";
import { safeNext } from "@/lib/auth/safe-next";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(token: string): Promise<ActionResult> {
  const nextPath = safeNext(`/invites/accept?token=${token}`, "/login");
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_org_invite", { p_token: token });
  if (error) return fail(error.message);

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return fail("Invite accepted. Sign in again to open the workspace.");

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
