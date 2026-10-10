"use server";

import { createHash } from "node:crypto";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { z } from "zod";
import { normalizeHex } from "@/lib/brand/derive-brand-theme";
import { prepareLogo } from "@/lib/brand/logo";
import { type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/types";

const schema = z.object({
  brand_color: z.string().trim().max(20),
  heading_font: z.enum(["classic", "clean", "sturdy"]),
  logo_shows_name: z.enum(["auto", "on", "off"]),
  logo_needs_chip: z.enum(["true", "false"]).optional(),
  remove_light: z.literal("true").optional(),
  remove_dark: z.literal("true").optional(),
});

function contentHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

export async function saveBranding(formData: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") {
    return { ok: false, error: "Only owners and admins can change branding." };
  }
  const parsed = schema.safeParse({
    brand_color: String(formData.get("brand_color") ?? ""),
    heading_font: formData.get("heading_font"),
    logo_shows_name: formData.get("logo_shows_name"),
    logo_needs_chip: formData.get("logo_needs_chip") || undefined,
    remove_light: formData.get("remove_light") || undefined,
    remove_dark: formData.get("remove_dark") || undefined,
  });
  if (!parsed.success || !parsed.data) return { ok: false, error: "Check the branding fields and try again." };
  const input = parsed.data;
  const color = input.brand_color ? normalizeHex(input.brand_color) : null;
  if (input.brand_color && !color) return { ok: false, error: "Enter a hex color like #1E5235." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: org, error: readError } = await supabase
    .from("orgs")
    .select("logo_path, logo_dark_path, logo_raster_path")
    .eq("id", session.orgId)
    .single();
  if (readError || !org) return { ok: false, error: readError?.message ?? "Company not found." };
  const current = org;

  const patch: TablesUpdate<"orgs"> = {
    brand_color: color,
    heading_font: input.heading_font,
    logo_shows_name: input.logo_shows_name === "auto" ? null : input.logo_shows_name === "on",
    branding_updated_at: new Date().toISOString(),
  };
  if (input.logo_needs_chip) patch.logo_needs_chip = input.logo_needs_chip === "true";

  const uploaded: string[] = [];
  const removed: string[] = [];

  async function store(kind: "light" | "dark", file: File): Promise<string | null> {
    const bytes = Buffer.from(await file.arrayBuffer());
    const prepared = await prepareLogo(bytes, file.type || "");
    if (!prepared.ok) return prepared.error;
    const hash = contentHash(prepared.logo.light);
    const path = `${session.orgId}/logo-${kind}-${hash}.${prepared.logo.lightExt}`;
    const { error } = await admin.storage.from("org-branding").upload(path, prepared.logo.light, {
      contentType: prepared.logo.lightType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) return error.message;
    uploaded.push(path);
    if (kind === "light") {
      const rasterPath = `${session.orgId}/logo-raster-${contentHash(prepared.logo.raster)}.png`;
      const raster = await admin.storage.from("org-branding").upload(rasterPath, prepared.logo.raster, {
        contentType: "image/png",
        cacheControl: "31536000",
        upsert: false,
      });
      if (raster.error) return raster.error.message;
      uploaded.push(rasterPath);
      patch.logo_path = path;
      patch.logo_raster_path = rasterPath;
      patch.logo_width = prepared.logo.width;
      patch.logo_height = prepared.logo.height;
      if (!input.logo_needs_chip) patch.logo_needs_chip = prepared.logo.needsChip;
      if (current.logo_path) removed.push(current.logo_path);
      if (current.logo_raster_path) removed.push(current.logo_raster_path);
    } else {
      patch.logo_dark_path = path;
      if (current.logo_dark_path) removed.push(current.logo_dark_path);
    }
    return null;
  }

  const light = formData.get("logo_light");
  const dark = formData.get("logo_dark");
  if (light instanceof File && light.size > 0) {
    const message = await store("light", light);
    if (message) return { ok: false, error: message };
  } else if (input.remove_light === "true") {
    patch.logo_path = null;
    patch.logo_raster_path = null;
    patch.logo_width = null;
    patch.logo_height = null;
    patch.logo_needs_chip = false;
    if (current.logo_path) removed.push(current.logo_path);
    if (current.logo_raster_path) removed.push(current.logo_raster_path);
  }
  if (dark instanceof File && dark.size > 0) {
    const message = await store("dark", dark);
    if (message) return { ok: false, error: message };
  } else if (input.remove_dark === "true") {
    patch.logo_dark_path = null;
    if (current.logo_dark_path) removed.push(current.logo_dark_path);
  }

  const { error } = await supabase.from("orgs").update(patch).eq("id", session.orgId);
  if (error) return { ok: false, error: error.message };
  const stale = removed.filter((path) => path && !uploaded.includes(path));
  if (stale.length > 0) await admin.storage.from("org-branding").remove(stale);

  revalidateTag(`org-branding:${session.orgId}`, "max");
  updateTag(`org-branding:${session.orgId}`);
  revalidatePath("/settings");
  return { ok: true };
}
