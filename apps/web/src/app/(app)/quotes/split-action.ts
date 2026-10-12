"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { QUOTE_CONVERT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { planQuoteSplit } from "@/lib/quotes/split-quote";
import { createClient } from "@/lib/supabase/server";

const groupSchema = z.object({
  title: z.string().trim().max(200),
  lineIds: z.array(z.string().uuid()).max(100),
});

const splitSchema = z.object({
  quoteId: z.string().uuid(),
  lines: z.array(z.object({ id: z.string().uuid(), name: z.string() })).max(100),
  groups: z.array(groupSchema).min(2).max(8),
});

const resultSchema = z.array(z.object({ job_id: z.string().uuid(), title: z.string() }));

export async function splitAcceptedQuote(input: z.infer<typeof splitSchema>): Promise<ActionResult<{ jobs: { id: string; title: string }[] }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, QUOTE_CONVERT_ROLES)) return fail("You don't have permission to split this quote.");
  const parsed = splitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid split");
  const plan = planQuoteSplit(parsed.data.lines, parsed.data.groups);
  if (!plan.ok) return fail(plan.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("split_accepted_quote", {
    p_quote: parsed.data.quoteId,
    p_groups: plan.groups.map((group) => ({ title: group.title, line_ids: group.lineIds })),
  });
  if (error || data == null) return fail(error?.message ?? "Could not split the quote");
  const jobs = resultSchema.safeParse(data);
  if (!jobs.success) return fail("Could not split the quote");
  revalidatePath(`/quotes/${parsed.data.quoteId}`);
  return { ok: true, data: { jobs: jobs.data.map((job) => ({ id: job.job_id, title: job.title })) } };
}
