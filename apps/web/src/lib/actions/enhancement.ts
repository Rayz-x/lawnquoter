"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { enhancementTitle } from "@/lib/agreements/enhancement";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  agreementId: z.string().uuid(),
  title: z.string(),
});

export async function proposeEnhancement(input: z.infer<typeof inputSchema>): Promise<ActionResult<{ quoteId: string }>> {
  await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("An enhancement needs a title");
  const title = enhancementTitle(parsed.data.title);
  if (!title) return fail("An enhancement needs a title");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_agreement_enhancement", {
    p_agreement: parsed.data.agreementId,
    p_title: title,
  });
  if (error) return fail(error.message);
  if (!data) return fail("Could not create the enhancement");
  return { ok: true, data: { quoteId: data } };
}
