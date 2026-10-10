"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();
const resolutionSchema = z.enum(["full", "partial", "zero"]);

const upsellOverrideSchema = z.object({
  enhancementRequestId: idSchema,
  amountCents: z.number().int().min(0),
  note: z.string().trim().min(1).max(2000),
});

const resolveInputSchema = z
  .object({
    visitId: idSchema,
    resolution: resolutionSchema,
    visitTaskIds: z.array(idSchema).default([]),
    upsellOverrides: z.array(upsellOverrideSchema).default([]),
  })
  .superRefine((input, ctx) => {
    if (input.resolution === "partial" && input.visitTaskIds.length < 1) {
      ctx.addIssue({ code: "custom", message: "Pick at least one line for a partial bill" });
    }
  });

export type ResolveBillingHoldInput = z.infer<typeof resolveInputSchema>;

export async function resolveBillingHold(
  input: ResolveBillingHoldInput,
): Promise<ActionResult<{ invoiceId: string; totalCents: number }>> {
  await requireOrg();
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid resolution");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_resolve_billing_hold", {
    p_visit_id: parsed.data.visitId,
    p_resolution: parsed.data.resolution,
    ...(parsed.data.resolution === "partial"
      ? { p_visit_task_ids: parsed.data.visitTaskIds }
      : {}),
    p_upsell_overrides: parsed.data.upsellOverrides.map((item) => ({
      enhancement_request_id: item.enhancementRequestId,
      amount_cents: item.amountCents,
      note: item.note,
    })),
  });

  if (error) return fail(error.message);
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id : null;
  const totalCents = typeof body?.total_cents === "number" ? body.total_cents : null;
  if (!invoiceId || totalCents == null) return fail("Could not resolve that visit");
  return { ok: true, data: { invoiceId, totalCents } };
}
