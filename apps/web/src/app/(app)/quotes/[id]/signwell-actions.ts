"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { SIGNWELL_NOT_CONNECTED, createSignWellClient, signWellConfigured } from "@/lib/billing/signwell";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function sendSignWellContract(quoteId: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return fail("You cannot send a contract.");
  if (!z.string().uuid().safeParse(quoteId).success) return fail("Quote not found.");
  if (!signWellConfigured()) return fail(SIGNWELL_NOT_CONNECTED);

  const supabase = await createClient();
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, title, public_token, signwell_document_id, account_id, accounts(type)")
    .eq("id", quoteId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (error || !quote) return fail("Quote not found.");
  const account = Array.isArray(quote.accounts) ? quote.accounts[0] : quote.accounts;
  if (account?.type !== "commercial") return fail("SignWell is for commercial contracts.");
  if (quote.signwell_document_id) return { ok: true };

  const { data: contact } = await supabase
    .from("contacts")
    .select("first_name, last_name, email")
    .eq("account_id", quote.account_id)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!contact?.email) return fail("Add an email on the account before sending the contract.");

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let documentId: string;
  try {
    const created = await createSignWellClient().createDocument({
      name: quote.title || "Commercial contract",
      fileUrl: `${origin}/q/${quote.public_token}/pdf`,
      recipientName: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Customer",
      recipientEmail: contact.email,
    });
    documentId = created.id;
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : SIGNWELL_NOT_CONNECTED);
  }

  const { error: saveError } = await supabase
    .from("quotes")
    .update({ signwell_document_id: documentId })
    .eq("id", quote.id)
    .eq("org_id", session.orgId);
  if (saveError) return fail(saveError.message);
  revalidatePath(`/quotes/${quote.id}`);
  return { ok: true };
}
