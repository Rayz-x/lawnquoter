import type { EmailProvider, OutboundEmail } from "@/lib/email/provider";

export const LEAD_STALE_AFTER_DAYS = 7;

/** Closed / ignored statuses never appear in the follow-up digest. */
const DIGEST_EXCLUDED_STATUSES = new Set(["spam", "won", "lost"]);

export type DigestLead = {
  id: string;
  orgId: string;
  assigneeId: string | null;
  assigneeEmail: string | null;
  nextFollowUpOn: string | null;
  lastActivityAt: string | null;
  status: string;
  contactName: string | null;
};

export type DigestSendKey = string;

export function digestSendKey(orgId: string, assigneeId: string, asOfDate: string): DigestSendKey {
  return `${orgId}:${assigneeId}:${asOfDate}`;
}

/** Due today or overdue. Future dates and excluded statuses are omitted. */
export function selectFollowUpsForDigest(leads: DigestLead[], asOfDate: string): DigestLead[] {
  return leads.filter((lead) => {
    if (DIGEST_EXCLUDED_STATUSES.has(lead.status)) return false;
    if (!lead.nextFollowUpOn) return false;
    return lead.nextFollowUpOn <= asOfDate;
  });
}

/**
 * Stale when the calendar day of last activity is at least 7 days before asOfDate.
 * Day 6 → false; day 7 → true. Missing activity is treated as stale.
 */
export function isLeadStale(
  lastActivityAt: string | null | undefined,
  asOfDate: string,
  staleAfterDays = LEAD_STALE_AFTER_DAYS,
): boolean {
  if (!lastActivityAt) return true;
  const activityDay = lastActivityAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDay) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return false;
  }
  const activityMs = Date.parse(`${activityDay}T00:00:00.000Z`);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(activityMs) || Number.isNaN(asOfMs)) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((asOfMs - activityMs) / dayMs) >= staleAfterDays;
}

/** Attach `stale` for inbox rows without inventing upstream schema. */
export function withStaleFlag<T extends { lastActivityAt?: string | null }>(
  rows: T[],
  asOfDate: string,
): Array<T & { stale: boolean }> {
  return rows.map((row) => ({
    ...row,
    stale: isLeadStale(row.lastActivityAt, asOfDate),
  }));
}

export function followUpDigestMessage(input: {
  to: string;
  orgName: string;
  asOfDate: string;
  items: DigestLead[];
}): OutboundEmail {
  const lines = input.items.map((item) => {
    const when = item.nextFollowUpOn ?? "—";
    const name = item.contactName?.trim() || "Lead";
    const bucket = item.nextFollowUpOn && item.nextFollowUpOn < input.asOfDate ? "Overdue" : "Due today";
    return `- ${bucket}: ${name} (follow-up ${when})`;
  });
  const text = `Your follow-ups for ${input.orgName} (${input.asOfDate}):

${lines.join("\n")}
`;
  return {
    to: input.to,
    subject: `Follow-ups due ${input.asOfDate} — ${input.orgName}`,
    text,
  };
}

export async function sendAssigneeDigests(input: {
  leads: DigestLead[];
  asOfDate: string;
  sentKeys: Set<DigestSendKey>;
  send: EmailProvider["send"];
  orgName: string;
}): Promise<{ sent: number; skipped: number }> {
  const selected = selectFollowUpsForDigest(input.leads, input.asOfDate);
  const byAssignee = new Map<string, DigestLead[]>();

  for (const row of selected) {
    if (!row.assigneeId || !row.assigneeEmail) continue;
    const list = byAssignee.get(row.assigneeId) ?? [];
    list.push(row);
    byAssignee.set(row.assigneeId, list);
  }

  let sent = 0;
  let skipped = 0;

  for (const [assigneeId, items] of byAssignee) {
    const orgId = items[0]?.orgId ?? "";
    const key = digestSendKey(orgId, assigneeId, input.asOfDate);
    if (input.sentKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const to = items[0]?.assigneeEmail;
    if (!to) {
      skipped += 1;
      continue;
    }
    const result = await input.send(
      followUpDigestMessage({
        to,
        orgName: input.orgName,
        asOfDate: input.asOfDate,
        items,
      }),
    );
    if (!result.sent) {
      skipped += 1;
      continue;
    }
    input.sentKeys.add(key);
    sent += 1;
  }

  return { sent, skipped };
}

/** True when the org-local clock is in the 7 AM hour (digest send window). */
export function isCompanyDigestHour(timeZone: string | null | undefined, now = new Date()): boolean {
  const zone = timeZone?.trim() || "UTC";
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hourCycle: "h23",
      }).formatToParts(now).find((part) => part.type === "hour")?.value,
    );
    return hour === 7;
  } catch {
    return false;
  }
}
