"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Mint (or return) the public statement token for an account. */
export async function ensureStatementLink(
  accountId: string,
): Promise<ActionResult<{ token: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) {
    return fail("Only office staff who can edit customers can create statement links.");
  }
  const parsed = z.string().uuid().safeParse(accountId);
  if (!parsed.success) return fail("Account not found");

  const supabase = await createClient();
  const client = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("ensure_account_statement_link", {
    p_account_id: parsed.data,
  });
  if (error) return fail(error.message);
  if (typeof data !== "string") return fail("Could not create statement link.");

  revalidatePath("/payments");
  return { ok: true, data: { token: data } };
}
