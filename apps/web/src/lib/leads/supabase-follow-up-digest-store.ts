import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { digestSendKey, type DigestLead, type DigestSendKey } from "./follow-up-digest";
import type { DigestOrg, FollowUpDigestStore } from "./run-follow-up-digest";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Production store. listFollowUpLeads returns [] only when `lead_requests`
 * is missing (SQLSTATE 42P01).
 */
export function createSupabaseFollowUpDigestStore(
  admin: AdminClient = createAdminClient(),
): FollowUpDigestStore {
  return {
    async listOrgs(): Promise<DigestOrg[]> {
      const { data, error } = await admin.from("orgs").select("id, name, timezone");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        timezone: row.timezone,
      }));
    },

    async listFollowUpLeads(orgId: string): Promise<DigestLead[]> {
      // Untyped until L01 is in database.types. Missing relation (42P01) returns [].
      const { data, error } = await (admin as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              value: string,
            ) => Promise<{
              data: Record<string, unknown>[] | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        };
      })
        .from("lead_requests")
        .select(
          "id, org_id, assignee_id, next_follow_up_on, status, contact_name, profiles:assignee_id(email)",
        )
        .eq("org_id", orgId);

      if (error) {
        if (error.code === "42P01") return [];
        throw new Error(error.message);
      }

      return (data ?? []).map((row) => {
        const profile = row.profiles as { email?: string | null } | null;
        return {
          id: String(row.id),
          orgId: String(row.org_id),
          assigneeId: row.assignee_id ? String(row.assignee_id) : null,
          assigneeEmail: profile?.email ?? null,
          nextFollowUpOn: row.next_follow_up_on ? String(row.next_follow_up_on).slice(0, 10) : null,
          lastActivityAt: null,
          status: String(row.status ?? "new"),
          contactName: row.contact_name ? String(row.contact_name) : null,
        };
      });
    },

    async listSentKeys(orgId: string, asOfDate: string): Promise<Set<DigestSendKey>> {
      const { data, error } = await (admin as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              value: string,
            ) => {
              eq: (
                col2: string,
                value2: string,
              ) => Promise<{
                data: { assignee_id: string }[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      })
        .from("lead_follow_up_digest_runs")
        .select("assignee_id")
        .eq("org_id", orgId)
        .eq("digest_on", asOfDate);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((row) => digestSendKey(orgId, row.assignee_id, asOfDate)));
    },

    async claimDigest(orgId: string, assigneeId: string, asOfDate: string): Promise<boolean> {
      const { data, error } = await admin.rpc("claim_lead_follow_up_digest", {
        p_org_id: orgId,
        p_assignee_id: assigneeId,
        p_digest_on: asOfDate,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}
