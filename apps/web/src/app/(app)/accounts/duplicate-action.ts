"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { loadAccountDuplicates } from "@/lib/accounts/load-duplicates";
import type { AccountDuplicate } from "@/lib/accounts/duplicates";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const addressSchema = z.object({
  addressLine1: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
});

const probeSchema = z.object({
  excludeAccountId: z.string().uuid().optional(),
  phones: z.array(z.string().max(40)).max(20),
  addresses: z.array(addressSchema).max(20),
});

export async function lookupAccountDuplicates(input: z.infer<typeof probeSchema>): Promise<ActionResult<AccountDuplicate[]>> {
  const session = await requireOrg();
  const parsed = probeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid duplicate check");
  const supabase = await createClient();
  try {
    const matches = await loadAccountDuplicates(supabase, session.orgId, {
      excludeAccountId: parsed.data.excludeAccountId,
      phones: parsed.data.phones,
      addresses: parsed.data.addresses.map((address) => ({
        addressLine1: address.addressLine1 || null,
        city: address.city || null,
        postalCode: address.postalCode || null,
      })),
    });
    return { ok: true, data: matches };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not check for duplicates");
  }
}
