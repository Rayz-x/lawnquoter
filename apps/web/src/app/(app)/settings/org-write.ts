import { ADMIN_ROLES, hasRole, type OrgRole } from "@lawnquoter/shared";
import type { Json } from "@/lib/supabase/database.types";

export const SETTINGS_NOT_SAVED = "Settings were not saved.";
export const SETTINGS_ADMIN_ONLY = "Only owners and admins can change company settings.";

export function orgSettingsDenied(role: OrgRole | null | undefined): string | null {
  return hasRole(role, ADMIN_ROLES) ? null : SETTINGS_ADMIN_ONLY;
}

export function mergeOrgSettings(current: Json, patch: Record<string, Json>): { [key: string]: Json | undefined } {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...base, ...patch };
}

export function orgUpdateFailure(error: { message: string } | null, row: unknown): string | null {
  if (error) return error.message;
  return row ? null : SETTINGS_NOT_SAVED;
}
