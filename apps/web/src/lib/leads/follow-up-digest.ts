import type { OutboundEmail } from "@/lib/email/provider";

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
