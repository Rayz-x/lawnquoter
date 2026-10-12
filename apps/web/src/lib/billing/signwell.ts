export const SIGNWELL_NOT_CONNECTED = "Not connected - add a SignWell key to enable.";

export type SignWellDocumentInput = {
  name: string;
  fileUrl: string;
  recipientName: string;
  recipientEmail: string;
};

export type SignWellClient = {
  createDocument(input: SignWellDocumentInput): Promise<{ id: string }>;
};

export function signWellApiKey(): string | null {
  const key = process.env.SIGNWELL_API_KEY?.trim();
  return key ? key : null;
}

export function signWellWebhookId(): string | null {
  const id = process.env.SIGNWELL_WEBHOOK_ID?.trim();
  return id ? id : null;
}

export function signWellConfigured(): boolean {
  return Boolean(signWellApiKey() && signWellWebhookId());
}

/** Talks to SignWell only when a key is set. Tests pass a fake fetch. */
export function createSignWellClient(fetchImpl: typeof fetch = fetch): SignWellClient {
  return {
    async createDocument(input) {
      const key = signWellApiKey();
      if (!key) throw new Error(SIGNWELL_NOT_CONNECTED);
      const response = await fetchImpl("https://www.signwell.com/api/v1/documents/", {
        method: "POST",
        headers: {
          "X-Api-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          test_mode: true,
          name: input.name,
          recipients: [{ id: "1", email: input.recipientEmail, name: input.recipientName }],
          files: [{ name: "contract.pdf", file_url: input.fileUrl }],
        }),
      });
      if (!response.ok) throw new Error("SignWell did not accept the contract.");
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== "string" || body.id.length === 0) throw new Error("SignWell did not accept the contract.");
      return { id: body.id };
    },
  };
}
