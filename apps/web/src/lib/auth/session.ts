import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { appMetadataSchema, type OrgRole } from "@lawnquoter/shared";
import { createClient } from "@/lib/supabase/server";

export type SessionContext = {
  userId: string;
  email: string | null;
  orgId: string | null;
  orgRole: OrgRole | null;
};

/** Reads the validated JWT claims once per request. Null when signed out. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const meta = appMetadataSchema.safeParse(claims.app_metadata ?? {});
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    orgId: meta.success ? (meta.data.org_id ?? null) : null,
    orgRole: meta.success ? (meta.data.org_role ?? null) : null,
  };
});

/** Redirects to /login when signed out, to /onboarding when the user has no org yet. */
export async function requireOrg(): Promise<SessionContext & { orgId: string; orgRole: OrgRole }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.orgId || !session.orgRole) redirect("/onboarding");
  return { ...session, orgId: session.orgId, orgRole: session.orgRole };
}
