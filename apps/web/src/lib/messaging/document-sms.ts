import { renderTemplate, suggestedTemplate } from "./template";
import { mayText, toE164, TWILIO_NOT_CONNECTED } from "./sms";

export type SmsContact = { id: string; phone: string | null; smsOptIn: boolean };

export type TextRecipient = { id: string; to: string; optedIn: boolean; inbound: boolean };

export function pickSmsContact(contacts: SmsContact[], inboundNumbers: string[]): TextRecipient | null {
  const inbound = new Set(inboundNumbers.map((value) => toE164(value)).filter((value): value is string => Boolean(value)));
  const reachable = contacts.flatMap((contact) => {
    const to = contact.phone ? toE164(contact.phone) : null;
    return to ? [{ id: contact.id, to, optedIn: contact.smsOptIn, inbound: inbound.has(to) }] : [];
  });
  return reachable.find((contact) => contact.optedIn) ?? reachable.find((contact) => contact.inbound) ?? reachable[0] ?? null;
}

export function documentSms(input: {
  purpose: "quote" | "invoice";
  status: string;
  templateBody: string | null;
  customerName: string;
  company: string;
  link: string | null;
  amount: string;
  address: string;
  contact: TextRecipient | null;
  connected: boolean;
}): { ok: true; to: string; body: string } | { ok: false; error: string } {
  if (!input.connected) return { ok: false, error: TWILIO_NOT_CONNECTED };
  if (input.purpose === "quote" && !["draft", "changed", "sent", "viewed"].includes(input.status)) {
    return { ok: false, error: "This quote can no longer be texted." };
  }
  if (input.purpose === "invoice" && input.status === "draft") return { ok: false, error: "Issue the invoice before texting it." };
  if (input.purpose === "invoice" && input.status === "void") return { ok: false, error: "A void invoice cannot be texted." };
  if (!input.link) return { ok: false, error: "This document has no public link." };
  if (!input.contact) return { ok: false, error: "Add a mobile number on this account before texting." };
  const allowed = mayText(input.contact);
  if (!allowed.ok) return allowed;
  const source = input.templateBody?.trim() || suggestedTemplate("sms", input.purpose).body;
  const rendered = renderTemplate(source, {
    customerName: input.customerName,
    company: input.company,
    link: input.link,
    amount: input.amount,
    address: input.address,
  });
  const body = rendered.includes(input.link) ? rendered : `${rendered} ${input.link}`.trim();
  if (!body || body.length > 1600) return { ok: false, error: "Enter a text up to 1,600 characters." };
  return { ok: true, to: input.contact.to, body };
}
