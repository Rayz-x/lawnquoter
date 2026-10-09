import { describe, expect, it } from "vitest";
import { createEmailProvider, createResendEmailProvider } from "./provider";
import { acceptedQuoteMessage } from "./accepted-quote";

const pdf = Buffer.from("%PDF-1.4 sealed");

describe("email provider", () => {
  it("does not send when Resend is not configured", async () => {
    const calls: string[] = [];
    const provider = createEmailProvider({
      env: {},
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("{}", { status: 200 });
      },
    });
    const result = await provider.send({ to: "pat@example.com", subject: "Quote", text: "Hello" });
    expect(result).toEqual({ id: null, sent: false });
    expect(calls).toEqual([]);
  });

  it("does not send real email when the process is a test", async () => {
    const calls: string[] = [];
    const provider = createEmailProvider({
      env: {
        NODE_ENV: "test",
        RESEND_API_KEY: "re_live_looking_key",
        EMAIL_FROM: "LawnQuoter <quotes@example.com>",
      },
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("{}", { status: 200 });
      },
    });
    const result = await provider.send({ to: "pat@example.com", subject: "Quote", text: "Hello" });
    expect(result.sent).toBe(false);
    expect(calls).toEqual([]);
  });

  it("posts a base64 PDF attachment when Resend is configured outside tests", async () => {
    let body: unknown;
    const provider = createResendEmailProvider({
      apiKey: "re_test",
      from: "LawnQuoter <quotes@example.com>",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      },
    });
    const message = acceptedQuoteMessage({
      to: "pat@example.com",
      orgName: "North Lawn",
      quoteNumber: 12,
      documentHash: "abc123",
      clause: "You agree to pay no more than $210.00; the final invoice may be lower.",
      pdf,
    });
    const result = await provider.send(message);
    expect(result).toEqual({ id: "email_1", sent: true });
    expect(body).toMatchObject({
      from: "LawnQuoter <quotes@example.com>",
      to: ["pat@example.com"],
      subject: "Accepted quote #12 from North Lawn",
      attachments: [
        {
          filename: "quote-12-accepted.pdf",
          content: pdf.toString("base64"),
        },
      ],
    });
    const parsed = body as { text: string };
    expect(parsed.text).toContain("abc123");
    expect(parsed.text).toContain("no more than $210.00");
  });
});
