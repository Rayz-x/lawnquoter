import type { EmailProvider, OutboundEmail } from "@/lib/email/provider";

export type NewLeadNotifyInput = {
  status: "new" | "spam";
  /** Assignee email when set; otherwise office/org email. */
  officeTo: string | null;
  requesterEmail: string | null;
  orgName: string;
  contactName: string;
  addressTyped: string;
  services: readonly string[];
  phone: string | null;
  replyWithinMinutes: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Human reply window for transactional confirmation copy. */
export function formatReplyWithin(minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 60;
  if (m === 60) return "1 hour";
  if (m % 60 === 0) {
    const hours = m / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return m === 1 ? "1 minute" : `${m} minutes`;
}

export function officeNewLeadEmail(input: {
  to: string;
  orgName: string;
  contactName: string;
  addressTyped: string;
  services: readonly string[];
  phone: string | null;
  email: string | null;
}): OutboundEmail {
  const services = input.services.length ? input.services.join(", ") : "not specified";
  const phoneLine = input.phone ? `Phone: ${input.phone}\n` : "";
  const emailLine = input.email ? `Email: ${input.email}\n` : "";
  const text = `New lead for ${input.orgName}

Name: ${input.contactName}
Address: ${input.addressTyped}
Services: ${services}
${phoneLine}${emailLine}`.trimEnd() + "\n";

  return {
    to: input.to,
    subject: `New lead — ${input.contactName} (${input.orgName})`,
    text,
  };
}

/** Transactional requester confirmation — no marketing content. */
export function requesterConfirmationEmail(input: {
  to: string;
  orgName: string;
  contactName: string;
  addressTyped: string;
  services: readonly string[];
  replyWithinMinutes: number;
}): OutboundEmail {
  const services = input.services.length ? input.services.join(", ") : "service";
  const window = formatReplyWithin(input.replyWithinMinutes);
  const text = `Hi ${input.contactName},

Thanks for contacting ${input.orgName}. We received your request for ${services} at ${input.addressTyped}.

We expect to reply within ${window}.

This message confirms your request only.
`;
  const html = `<p>Hi ${escapeHtml(input.contactName)},</p>
<p>Thanks for contacting ${escapeHtml(input.orgName)}. We received your request for ${escapeHtml(services)} at ${escapeHtml(input.addressTyped)}.</p>
<p>We expect to reply within ${escapeHtml(window)}.</p>
<p>This message confirms your request only.</p>`;

  return {
    to: input.to,
    subject: `We received your request — ${input.orgName}`,
    text,
    html,
  };
}

/**
 * Build the outbound queue for a stored lead.
 * Spam → empty. Non-spam → one office/assignee email, plus confirmation iff requester email present.
 */
export function queueNewLeadEmails(input: NewLeadNotifyInput): OutboundEmail[] {
  if (input.status !== "new") return [];

  const queued: OutboundEmail[] = [];
  if (input.officeTo?.trim()) {
    queued.push(
      officeNewLeadEmail({
        to: input.officeTo.trim(),
        orgName: input.orgName,
        contactName: input.contactName,
        addressTyped: input.addressTyped,
        services: input.services,
        phone: input.phone,
        email: input.requesterEmail,
      }),
    );
  }
  if (input.requesterEmail?.trim()) {
    queued.push(
      requesterConfirmationEmail({
        to: input.requesterEmail.trim().toLowerCase(),
        orgName: input.orgName,
        contactName: input.contactName,
        addressTyped: input.addressTyped,
        services: input.services,
        replyWithinMinutes: input.replyWithinMinutes,
      }),
    );
  }
  return queued;
}

export async function sendQueuedNewLeadEmails(
  input: NewLeadNotifyInput,
  send: EmailProvider["send"],
): Promise<{ officeSent: number; confirmationSent: number }> {
  const queued = queueNewLeadEmails(input);
  let officeSent = 0;
  let confirmationSent = 0;
  for (const message of queued) {
    const result = await send(message);
    if (!result.sent) continue;
    if (input.officeTo && message.to === input.officeTo.trim()) officeSent += 1;
    else confirmationSent += 1;
  }
  return { officeSent, confirmationSent };
}
