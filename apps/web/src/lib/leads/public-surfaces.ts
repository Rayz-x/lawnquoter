import type { OutboundEmail } from "@/lib/email/provider";

/** Fields safe to echo on public lead intake / ack emails. No pricing. */
export type LeadPublicFields = {
  contactName: string;
  services: readonly string[];
  typedAddress: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Confirmation copy for the hosted public form. Never includes prices. */
export function leadPublicFormCopy(lead: LeadPublicFields): string {
  const services = lead.services.length ? lead.services.join(", ") : "your request";
  return `Thanks, ${lead.contactName}. We received your request for ${services} at ${lead.typedAddress}. We will be in touch shortly.`;
}

/** Customer acknowledgment email for a new lead. Never includes prices. */
export function leadAckEmail(input: {
  to: string;
  orgName: string;
  lead: LeadPublicFields;
}): OutboundEmail {
  const text = `Thanks for contacting ${input.orgName}.

We received your request for ${input.lead.services.join(", ") || "service"} at ${input.lead.typedAddress}.

Someone from our office will follow up soon.
`;
  const html = `<p>Thanks for contacting ${escapeHtml(input.orgName)}.</p>
<p>We received your request for ${escapeHtml(input.lead.services.join(", ") || "service")} at ${escapeHtml(input.lead.typedAddress)}.</p>
<p>Someone from our office will follow up soon.</p>`;

  return {
    to: input.to,
    subject: `We got your request — ${input.orgName}`,
    text,
    html,
  };
}
