import type { OrgRole } from "@lawnquoter/shared";

/** Roles that can read office agreements, crews, and the dispatch board. */
export const OFFICE_ROLES = ["owner", "admin", "sales", "dispatcher", "read_only"] as const satisfies readonly OrgRole[];

/** Roles that may turn an accepted quote into a job. Matches quote conversion. */
export const QUOTE_CONVERT_ROLES = ["owner", "admin", "dispatcher", "sales"] as const satisfies readonly OrgRole[];

/** Roles that may edit accounts and properties. Matches `private.can_edit_customers`. */
export const CUSTOMER_EDIT_ROLES = ["owner", "admin", "sales", "dispatcher"] as const satisfies readonly OrgRole[];
