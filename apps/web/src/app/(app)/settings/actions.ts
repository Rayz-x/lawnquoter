"use server";

import { revalidatePath } from "next/cache";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { z } from "zod";
import { orgRoleSchema } from "@lawnquoter/shared";
import { isHttpUrl } from "@/lib/brand/urls";
import { requireOrg } from "@/lib/auth/session";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const orgSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || isHttpUrl(value), "Enter a website that starts with http:// or https://.")
    .optional()
    .or(z.literal("")),
  address_line1: z.string().trim().max(200).optional().or(z.literal("")),
  address_line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  region: z.string().trim().max(100).optional().or(z.literal("")),
  postal_code: z.string().trim().max(20).optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(64),
});

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === "" ? null : v])) as T;
}

export async function updateOrgSettings(formData: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = orgSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update(emptyToNull(parsed.data)).eq("id", session.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
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
