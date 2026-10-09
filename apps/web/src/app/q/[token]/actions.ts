"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";

const acceptSchema = z.object({
  signer_name: z.string().trim().min(2, "Enter your full name"),
  signer_email: z.string().trim().email().optional().or(z.literal("")),
  disclosure: z.literal(true, { error: "Please accept the electronic signature disclosure" }),
  selected: z.array(z.string().uuid()).default([]),
});

function clientIp(hdrs: Headers): string | null {
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || hdrs.get("x-real-ip")?.trim() || "";
  if (!raw || !/^[0-9a-fA-F:.]+$/.test(raw)) return null;
  return raw;
}

export async function acceptQuote(token: string, fd: FormData): Promise<ActionResult<{ hash: string; already: boolean }>> {
  const parsed = acceptSchema.safeParse({
    signer_name: fd.get("signer_name"),
    signer_email: fd.get("signer_email") ?? "",
    disclosure: fd.get("disclosure") === "on" || fd.get("disclosure") === "true" ? true : false,
    selected: fd.getAll("selected"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again");

  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const userAgent = hdrs.get("user-agent");
  const forwarded: Record<string, string> = {};
  if (ip) forwarded["x-forwarded-for"] = ip;
  if (userAgent) forwarded["user-agent"] = userAgent;
  const supabase = await createClient({ headers: forwarded });
  const { data, error } = await supabase.rpc("quote_accept", {
    p_token: token,
    p_signer_name: parsed.data.signer_name,
    p_signer_email: parsed.data.signer_email || undefined,
    p_disclosure: true,
    p_selected: parsed.data.selected,
  });
  if (error) return fail(error.message);
  const body = data && typeof data === "object" ? (data as { document_hash?: string; already?: boolean }) : {};
  return { ok: true, data: { hash: body.document_hash ?? "", already: body.already === true } };
}

export async function declineQuote(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("quote_decline", { p_token: token });
  if (error) return fail(error.message);
  return { ok: true };
}
