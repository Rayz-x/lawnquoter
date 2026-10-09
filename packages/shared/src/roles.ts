import { z } from "zod";

/** Roles an org member can hold. Mirrors the `org_role` Postgres enum. */
export const ORG_ROLES = [
  "owner",
  "admin",
  "sales",
  "dispatcher",
  "crew_lead",
  "crew",
  "read_only",
] as const;

export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** Roles allowed to manage org settings, users, pricing and integrations. */
export const ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];
/** Roles allowed to create and send quotes. */
export const SALES_ROLES: readonly OrgRole[] = ["owner", "admin", "sales"];
/** Roles allowed to schedule and dispatch. */
export const DISPATCH_ROLES: readonly OrgRole[] = ["owner", "admin", "dispatcher"];
/** Roles that use the crew mobile app. */
export const FIELD_ROLES: readonly OrgRole[] = ["owner", "admin", "dispatcher", "crew_lead", "crew"];

export function hasRole(role: OrgRole | null | undefined, allowed: readonly OrgRole[]): boolean {
  return !!role && allowed.includes(role);
}

/** Claims the custom access token hook stamps into `app_metadata`. */
export const appMetadataSchema = z.object({
  org_id: z.string().uuid().nullable().optional(),
  org_role: orgRoleSchema.nullable().optional(),
});
export type AppMetadata = z.infer<typeof appMetadataSchema>;
