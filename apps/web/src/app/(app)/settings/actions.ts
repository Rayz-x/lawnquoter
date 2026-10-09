"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgRoleSchema } from "@lawnquoter/shared";
import { isHttpUrl } from "@/lib/brand/urls";
import { requireOrg } from "@/lib/auth/session";
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

async function findUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const { data: profile } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (profile?.id) return profile.id;
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

/**
 * Invites a teammate: creates (or finds) the auth user, adds an active
 * membership in the caller's org, and emails a sign-in link.
 */
export async function inviteMember(formData: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") {
    return { ok: false, error: "Only owners and admins can invite." };
  }
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter a valid email and role." };
  if (parsed.data.role === "owner") return { ok: false, error: "Transfer ownership from the member list instead." };

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback?next=/dashboard`,
  });

  let userId = invited?.user?.id ?? null;
  if (inviteError) {
    userId = await findUserIdByEmail(admin, parsed.data.email);
    if (!userId) return { ok: false, error: inviteError.message };
  }
  if (!userId) return { ok: false, error: "Could not create the user." };

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email: parsed.data.email }, { onConflict: "id" });
  if (profileError) return { ok: false, error: profileError.message };

  const { error } = await admin.from("memberships").upsert(
    {
      org_id: session.orgId,
      user_id: userId,
      role: parsed.data.role,
      status: "active",
      invited_email: parsed.data.email,
    },
    { onConflict: "org_id,user_id" },
  );
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
