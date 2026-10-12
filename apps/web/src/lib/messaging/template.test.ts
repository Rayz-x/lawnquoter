import { describe, expect, it } from "vitest";
import { parseTemplateDraft, renderTemplate, suggestedTemplate, type TemplateDraft } from "./template";

const draft = (overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: "Quote text",
  channel: "sms",
  purpose: "quote",
  subject: "",
  body: "Your quote: {link}",
  isDefault: false,
  ...overrides,
});

describe("message templates", () => {
  it("fills a quote text with the customer, company, and link", () => {
    expect(renderTemplate("Hi {customer name}, {company} sent your quote: {link}", {
      customerName: "Pat Lee",
      company: "North Lawn",
      link: "https://app.example/q/abc",
    })).toBe("Hi Pat Lee, North Lawn sent your quote: https://app.example/q/abc");
  });

  it("leaves a missing amount as the placeholder", () => {
    expect(renderTemplate("Balance {amount}", { customerName: "Pat Lee" })).toBe("Balance {amount}");
  });

  it("rejects an unknown placeholder", () => {
    expect(parseTemplateDraft(draft({ body: "Hi {nickname}", isDefault: true }))).toEqual({
      ok: false,
      error: 'Unknown placeholder "{nickname}". Use customer name, company, link, amount, or address.',
    });
  });

  it("requires a subject on an email template", () => {
    expect(parseTemplateDraft(draft({ name: "Quote email", channel: "email", subject: "  " }))).toEqual({
      ok: false,
      error: "Enter a subject for an email.",
    });
  });

  it("rejects a subject on a text template", () => {
    expect(parseTemplateDraft(draft({ subject: "Quote" }))).toEqual({
      ok: false,
      error: "Text messages do not have a subject.",
    });
  });

  it("suggests on-my-way wording with the address", () => {
    expect(suggestedTemplate("sms", "on_my_way")).toEqual({
      subject: null,
      body: "{company} is on the way to {address}.",
    });
  });
});
