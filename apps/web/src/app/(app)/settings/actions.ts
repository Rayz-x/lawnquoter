"use server";

import { revalidatePath } from "next/cache";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { z } from "zod";
import { orgRoleSchema } from "@lawnquoter/shared";
import { emptyToNull, type ActionResult } from "@/lib/actions/result";
import { isHttpUrl } from "@/lib/brand/urls";
import { geocodeAddress } from "@/lib/geo/geocode";
import { requireOrg } from "@/lib/auth/session";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import type { Json } from "@/lib/supabase/database.types";
import type { TablesUpdate } from "@/lib/supabase/types";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { mergeOrgSettings, orgSettingsDenied, orgUpdateFailure } from "./org-write";

const UNRESOLVED_ADDRESS = "That address didn't resolve.";

export type OrgAddress = { address_line1: string | null; address_line2: string | null; city: string | null; region: string | null; postal_code: string | null };
type OrgCardResult = { ok: true; address?: OrgAddress } | { ok: false; error: string; unresolved?: boolean };

const zipPattern = /^\d{5}(?:-\d{4})?$/;
const text = (max: number) => z.string().trim().max(max);
const issue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid input";

async function writeOrg(patch: TablesUpdate<"orgs">, settingsPatch?: Record<string, Json>): Promise<OrgCardResult> {
  const session = await requireOrg();
  const denied = orgSettingsDenied(session.orgRole);
  if (denied) return { ok: false, error: denied };
  const supabase = await createClient();
  let next = patch;
  if (settingsPatch) {
    const { data, error } = await supabase.from("orgs").select("settings, updated_at").eq("id", session.orgId).single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not read settings." };
    next = { ...patch, settings: mergeOrgSettings(data.settings, settingsPatch) };
    const { data: row, error: updateError } = await supabase.from("orgs").update(next).eq("id", session.orgId).eq("updated_at", data.updated_at).select("id").maybeSingle();
    const fail = orgUpdateFailure(updateError, row);
    if (fail) return { ok: false, error: fail.toLowerCase().includes("invalid timezone") ? "Choose a known timezone, such as America/Chicago." : fail };
  } else {
    const { data: row, error } = await supabase.from("orgs").update(next).eq("id", session.orgId).select("id").maybeSingle();
    const fail = orgUpdateFailure(error, row);
    if (fail) return { ok: false, error: fail };
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveOrgCard(formData: FormData): Promise<OrgCardResult> {
  const raw = Object.fromEntries(formData);
  const section = String(raw.section ?? "");
  if (section === "identity") {
    const parsed = z.object({ name: z.string().trim().min(1, "Enter a company name.").max(120) }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: issue(parsed.error) };
    return writeOrg({ name: parsed.data.name });
  }
  if (section === "contact") {
    const parsed = z.object({
      phone: text(40).refine((value) => value === "" || (/^[0-9+().\-\s]+$/.test(value) && value.replace(/\D/g, "").length >= 10), "Enter a phone number with at least 10 digits."),
      email: text(200).refine((value) => value === "" || z.string().email().safeParse(value).success, "Enter a valid email."),
      website: text(200).refine((value) => value === "" || isHttpUrl(value), "Enter a website that starts with http:// or https://."),
    }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: issue(parsed.error) };
    return writeOrg(emptyToNull(parsed.data));
  }
  if (section === "address") {
    const parsed = z.object({
      address_line1: text(200),
      address_line2: text(200),
      city: text(100),
      region: text(100),
      postal_code: text(20).refine((value) => value === "" || zipPattern.test(value), "Enter a 5-digit ZIP."),
      use_as_typed: z.enum(["true", "false"]).optional(),
    }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: issue(parsed.error) };
    const typed = parsed.data;
    const any = [typed.address_line1, typed.address_line2, typed.city, typed.region, typed.postal_code].some(Boolean);
    if (any && (!typed.address_line1 || !typed.city || !typed.region || !typed.postal_code)) return { ok: false, error: "Enter a street, city, state, and ZIP." };
    let line1 = typed.address_line1;
    let city = typed.city;
    let region = typed.region;
    let postal = typed.postal_code;
    if (any && typed.use_as_typed !== "true") {
      const hit = await geocodeAddress([line1, city, region, postal].filter(Boolean).join(", "));
      if (!hit) return { ok: false, error: UNRESOLVED_ADDRESS, unresolved: true };
      line1 = hit.addressLine1 || line1;
      city = hit.city || city;
      region = hit.region || region;
      postal = zipPattern.test(hit.postalCode) ? hit.postalCode : postal;
    }
    const address: OrgAddress = { address_line1: line1 || null, address_line2: typed.address_line2 || null, city: city || null, region: region || null, postal_code: postal || null };
    const saved = await writeOrg(address);
    return saved.ok ? { ok: true, address } : saved;
  }
  if (section === "region") {
    const parsed = z.object({ timezone: z.string().trim().min(1, "Choose a timezone.").max(64), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code."), week_start: z.enum(["monday", "sunday"]).optional() }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: issue(parsed.error) };
    const patch = parsed.data.week_start ? { week_start: parsed.data.week_start } : undefined;
    return writeOrg({ timezone: parsed.data.timezone, currency: parsed.data.currency }, patch);
  }
  if (section === "quotes") {
    const parsed = z.object({ quote_expiry_days: z.coerce.number().refine((days) => [14, 30, 60, 90].includes(days), "Choose 14, 30, 60, or 90 days."), quote_deposit: z.enum(["none", "10", "25", "50"]) }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: issue(parsed.error) };
    return writeOrg({}, { quote_expiry_days: parsed.data.quote_expiry_days, quote_deposit: parsed.data.quote_deposit });
  }
  return { ok: false, error: "Unknown settings section." };
}

export async function lookupOfficeAddress(query: string) {
  const session = await requireOrg();
  const denied = orgSettingsDenied(session.orgRole);
  if (denied) return { ok: false as const, error: denied };
  const single = query.trim();
  if (single.length < 5) return { ok: false as const };
  const hit = await geocodeAddress(single);
  if (!hit) return { ok: false as const };
  return { ok: true as const, line1: hit.addressLine1 || single, city: hit.city, region: hit.region, postal: hit.postalCode, label: hit.formattedAddress };
}

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: orgRoleSchema,
});

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function alreadyRegistered(error: { message: string; status?: number }) {
  const message = error.message.toLowerCase();
  return error.status === 422 || message.includes("already been registered") || message.includes("already registered");
}

/**
 * Emails a sign-in link. The service role does not decide membership:
 * create_org_invite already stored a pending invite the recipient must accept.
 * Existing accounts cannot be invited again, so they get a magic link instead.
 */
async function emailInviteLink(email: string, nextPath: string): Promise<string | null> {
  const redirectTo = `${appOrigin()}/auth/callback?next=${encodeURIComponent(nextPath)}`;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return null;
  if (!alreadyRegistered(error)) return error.message;

  const anon = createBareClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpError } = await anon.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  return otpError?.message ?? null;
}

/**
 * Creates a pending invite after a live owner/admin check, then emails a link.
 * The invitee gets a membership only by accepting.
 */
export async function inviteMember(formData: FormData): Promise<ActionResult> {
  await requireOrg();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter a valid email and role." };
  if (parsed.data.role === "owner") return { ok: false, error: "Transfer ownership from the member list instead." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_org_invite", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error || !data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string") {
    return { ok: false, error: error?.message ?? "Could not create the invite." };
  }

  const emailError = await emailInviteLink(parsed.data.email, `/invites/accept?token=${data.token}`);
  if (emailError) return { ok: false, error: emailError };
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_org_invite", { p_id: inviteId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}

const memberUpdateSchema = z.object({
  membership_id: z.string().uuid(),
  role: orgRoleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function updateMember(formData: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = memberUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (parsed.data.role === "owner") return { ok: false, error: "Transfer ownership is not supported yet." };
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("id, user_id, role, status")
    .eq("id", parsed.data.membership_id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!membership) return { ok: false, error: "Member not found." };
  if (membership.role === "owner") return { ok: false, error: "The owner membership cannot be changed here." };
  if (membership.user_id === session.userId && parsed.data.status === "disabled") {
    return { ok: false, error: "You cannot disable your own access." };
  }
  const patch: { role?: z.infer<typeof orgRoleSchema>; status?: "active" | "disabled" } = {};
  if (parsed.data.role) patch.role = parsed.data.role;
  if (parsed.data.status) patch.status = parsed.data.status;
  const { error } = await supabase
    .from("memberships")
    .update(patch)
    .eq("id", parsed.data.membership_id)
    .eq("org_id", session.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}

const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter your name." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(emptyToNull(parsed.data)).eq("id", session.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
