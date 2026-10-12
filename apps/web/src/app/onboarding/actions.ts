"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { normalizeHex } from "@/lib/brand/derive-brand-theme";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { mergeOrgSettings } from "@/app/(app)/settings/org-write";
import { WIZARD_STEPS, parseServiceZips } from "./wizard";

const inputSchema = z.object({
  step: z.enum(WIZARD_STEPS).optional(),
  brandColor: z.string().trim().max(20).optional(),
  serviceArea: z.string().max(500).optional(),
  complete: z.boolean().optional(),
});

/** Saves wizard progress on the company that was just created. Existing settings keys stay. */
export async function saveOnboarding(input: unknown): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) return fail("Only an owner or admin can finish company setup.");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the setup fields.");

  const settingsPatch: Record<string, Json> = {};
  const columnPatch: { brand_color?: string | null } = {};
  if (parsed.data.brandColor !== undefined) {
    const color = parsed.data.brandColor ? normalizeHex(parsed.data.brandColor) : null;
    if (parsed.data.brandColor && !color) return fail("Enter a hex color like #1E5235.");
    columnPatch.brand_color = color;
  }
  if (parsed.data.serviceArea !== undefined) {
    const zips = parseServiceZips(parsed.data.serviceArea);
    if (!zips.ok) return fail(zips.error);
    settingsPatch.lead_service_area_zips = zips.zips;
  }
  if (parsed.data.complete) {
    settingsPatch.onboarding_complete = true;
    settingsPatch.onboarding_step = null;
  } else if (parsed.data.step) {
    settingsPatch.onboarding_step = parsed.data.step;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").select("settings, updated_at").eq("id", session.orgId).single();
  if (error || !data) return fail(error?.message ?? "Could not read company settings.");
  const { data: row, error: updateError } = await supabase
    .from("orgs")
    .update({ ...columnPatch, settings: mergeOrgSettings(data.settings, settingsPatch) })
    .eq("id", session.orgId)
    .eq("updated_at", data.updated_at)
    .select("id")
    .maybeSingle();
  if (updateError) return fail(updateError.message);
  if (!row) return fail("Setup was not saved. Refresh and try again.");
  revalidatePath("/onboarding");
  revalidatePath("/", "layout");
  return { ok: true };
}
