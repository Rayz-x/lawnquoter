export const MESSAGE_CHANNELS = ["email", "sms"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_PURPOSES = ["quote", "invoice", "on_my_way", "reminder", "follow_up", "abandoned", "general"] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const TEMPLATE_TOKENS = ["customer name", "company", "link", "amount", "address"] as const;

const TOKEN_KEYS = {
  "customer name": "customerName",
  company: "company",
  link: "link",
  amount: "amount",
  address: "address",
} as const;

export type TemplateVars = { customerName?: string; company?: string; link?: string; amount?: string; address?: string };

export type TemplateDraft = { name: string; channel: string; purpose: string; subject: string; body: string; isDefault: boolean };
export type ParsedTemplate = { name: string; channel: MessageChannel; purpose: MessagePurpose; subject: string | null; body: string; isDefault: boolean };

const COPY: Record<MessagePurpose, readonly [subject: string, sms: string, email: string]> = {
  quote: ["Your quote from {company}", "Hi {customer name}, {company} sent your quote: {link}", "Hi {customer name},\n\nYour quote from {company} is ready: {link}"],
  invoice: ["Invoice from {company}", "Hi {customer name}, your invoice from {company} for {amount} is ready: {link}", "Hi {customer name},\n\nYour invoice for {amount} is ready: {link}"],
  on_my_way: ["{company} is on the way", "{company} is on the way to {address}.", "{company} is on the way to {address}."],
  reminder: ["Reminder from {company}", "Hi {customer name}, a reminder from {company} about {amount}: {link}", "Hi {customer name},\n\nThis is a reminder about {amount}: {link}"],
  follow_up: ["Following up on your quote", "Hi {customer name}, checking that you saw the quote from {company}: {link}", "Hi {customer name},\n\nJust checking that you saw the quote from {company}: {link}"],
  abandoned: ["Your quote is still open", "Hi {customer name}, your quote from {company} is still open: {link}", "Hi {customer name},\n\nYour quote from {company} is still open: {link}"],
  general: ["Message from {company}", "Hi {customer name}, this is {company}.", "Hi {customer name},\n\nThis is {company}."],
};

export const PURPOSE_LABELS: Record<MessagePurpose, string> = {
  quote: "Quote",
  invoice: "Invoice",
  on_my_way: "On my way",
  reminder: "Reminder",
  follow_up: "Follow-up",
  abandoned: "Abandoned quote",
  general: "General",
};

export function suggestedTemplate(channel: MessageChannel, purpose: MessagePurpose) {
  const [subject, sms, email] = COPY[purpose];
  return channel === "sms" ? { subject: null, body: sms } : { subject, body: email };
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{([^{}]+)\}/g, (match, raw: string) => {
    const key = TOKEN_KEYS[raw.trim().toLowerCase() as keyof typeof TOKEN_KEYS];
    if (!key) return match;
    const value = vars[key];
    return value == null || value === "" ? match : value;
  });
}

function isChannel(value: string): value is MessageChannel {
  return (MESSAGE_CHANNELS as readonly string[]).includes(value);
}

function isPurpose(value: string): value is MessagePurpose {
  return (MESSAGE_PURPOSES as readonly string[]).includes(value);
}

export function parseTemplateDraft(draft: TemplateDraft): { ok: true; value: ParsedTemplate } | { ok: false; error: string } {
  const name = draft.name.trim();
  const body = draft.body.trim();
  const subject = draft.subject.trim();
  if (!name || name.length > 80) return { ok: false, error: "Enter a name up to 80 characters." };
  if (!isChannel(draft.channel)) return { ok: false, error: "Choose email or text." };
  if (!isPurpose(draft.purpose)) return { ok: false, error: "Choose what this message is for." };
  if (!body || body.length > 1600) return { ok: false, error: "Enter a message up to 1,600 characters." };
  const unknown = [...`${subject}\n${body}`.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((token) => !(token.toLowerCase() in TOKEN_KEYS));
  if (unknown[0]) {
    return { ok: false, error: `Unknown placeholder "{${unknown[0]}}". Use customer name, company, link, amount, or address.` };
  }
  if (draft.channel === "email" && !subject) return { ok: false, error: "Enter a subject for an email." };
  if (draft.channel === "email" && subject.length > 200) return { ok: false, error: "Keep the subject under 200 characters." };
  if (draft.channel === "sms" && subject) return { ok: false, error: "Text messages do not have a subject." };
  return { ok: true, value: { name, channel: draft.channel, purpose: draft.purpose, subject: draft.channel === "email" ? subject : null, body, isDefault: draft.isDefault } };
}
