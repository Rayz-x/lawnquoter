"use server";

import { headers } from "next/headers";
import { fail, type ActionResult } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";

export async function acceptQuote(token: string, fd: FormData): Promise<ActionResult<{ hash: string }>> {
  const name = String(fd.get("signer_name") ?? "").trim();
  const email = String(fd.get("signer_email") ?? "").trim();
  const disclosure = fd.get("disclosure") === "on" || fd.get("disclosure") === "true";
  if (!disclosure) return fail("Please accept the electronic signature disclosure");
  const hdrs = await headers();
  const ua = hdrs.get("user-agent");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_accept", {
    p_token: token,
    p_signer_name: name,
    p_signer_email: email || undefined,
    p_disclosure: true,
    p_user_agent: ua ?? undefined,
  });
  if (error) return fail(error.message);
  const hash = typeof data === "object" && data && "document_hash" in data ? String((data as { document_hash: string }).document_hash) : "";
  return { ok: true, data: { hash } };
}

export async function declineQuote(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("quote_decline", { p_token: token });
  if (error) return fail(error.message);
  return { ok: true };
}
