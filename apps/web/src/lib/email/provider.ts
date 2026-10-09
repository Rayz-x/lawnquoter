export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

export type EmailSendResult = { id: string | null; sent: boolean };

export interface EmailProvider {
  send(message: OutboundEmail): Promise<EmailSendResult>;
}

const noopProvider: EmailProvider = {
  async send() {
    return { id: null, sent: false };
  },
};

type MailFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createResendEmailProvider(options: {
  apiKey: string;
  from: string;
  fetch: MailFetch;
}): EmailProvider {
  return {
    async send(message) {
      const response = await options.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content.toString("base64"),
            content_type: attachment.contentType,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(`email provider rejected the message (${response.status})`);
      }
      const payload = (await response.json()) as { id?: string };
      return { id: payload.id ?? null, sent: true };
    },
  };
}

/**
 * Resend when RESEND_API_KEY and EMAIL_FROM are set. Otherwise a no-op.
 * Tests never send: NODE_ENV=test or VITEST short-circuits even if keys are present.
 */
export function createEmailProvider(options?: {
  env?: Record<string, string | undefined>;
  fetch?: MailFetch;
}): EmailProvider {
  const env = options?.env ?? process.env;
  if (env.NODE_ENV === "test" || env.VITEST) return noopProvider;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return noopProvider;
  return createResendEmailProvider({
    apiKey,
    from,
    fetch: options?.fetch ?? ((input, init) => fetch(input, init)),
  });
}
