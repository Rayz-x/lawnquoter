import { createEmailProvider } from "@/lib/email/provider";
import { orgToday } from "@/lib/scheduling/office-date";
import {
  digestSendKey,
  followUpDigestMessage,
  isCompanyDigestHour,
  selectFollowUpsForDigest,
  type DigestLead,
  type DigestSendKey,
} from "./follow-up-digest";

export type DigestOrg = {
  id: string;
  name: string;
  timezone: string | null;
};

export type FollowUpDigestStore = {
  listOrgs(): Promise<DigestOrg[]>;
  /** Soft dep on L01: return [] when lead_requests is not available yet. */
  listFollowUpLeads(orgId: string): Promise<DigestLead[]>;
  listSentKeys(orgId: string, asOfDate: string): Promise<Set<DigestSendKey>>;
  claimDigest(orgId: string, assigneeId: string, asOfDate: string): Promise<boolean>;
};

/**
 * For each org in the 7 AM company-time window, email due/overdue follow-ups
 * once per assignee per day.
 */
export async function runFollowUpDigestJob(input: {
  store: FollowUpDigestStore;
  now?: Date;
  send?: ReturnType<typeof createEmailProvider>["send"];
}): Promise<{ orgsConsidered: number; digestsSent: number; digestsSkipped: number }> {
  const now = input.now ?? new Date();
  const provider = createEmailProvider();
  const send = input.send ?? ((message) => provider.send(message));
  const orgs = await input.store.listOrgs();
  let digestsSent = 0;
  let digestsSkipped = 0;
  let orgsConsidered = 0;

  for (const org of orgs) {
    if (!isCompanyDigestHour(org.timezone, now)) continue;
    orgsConsidered += 1;
    const asOfDate = orgToday(org.timezone, now);
    const leads = selectFollowUpsForDigest(await input.store.listFollowUpLeads(org.id), asOfDate);
    const sentKeys = await input.store.listSentKeys(org.id, asOfDate);

    const byAssignee = new Map<string, DigestLead[]>();
    for (const row of leads) {
      if (!row.assigneeId || !row.assigneeEmail) continue;
      const list = byAssignee.get(row.assigneeId) ?? [];
      list.push(row);
      byAssignee.set(row.assigneeId, list);
    }

    for (const [assigneeId, items] of byAssignee) {
      const key = digestSendKey(org.id, assigneeId, asOfDate);
      if (sentKeys.has(key)) {
        digestsSkipped += 1;
        continue;
      }
      const claimed = await input.store.claimDigest(org.id, assigneeId, asOfDate);
      if (!claimed) {
        digestsSkipped += 1;
        continue;
      }
      const to = items[0]?.assigneeEmail;
      if (!to) {
        digestsSkipped += 1;
        continue;
      }
      const result = await send(
        followUpDigestMessage({
          to,
          orgName: org.name,
          asOfDate,
          items,
        }),
      );
      if (result.sent) digestsSent += 1;
      else digestsSkipped += 1;
    }
  }

  return { orgsConsidered, digestsSent, digestsSkipped };
}
