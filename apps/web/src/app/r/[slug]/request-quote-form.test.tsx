import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildHostedIntakeBody,
  submitHostedQuoteRequest,
  type HostedQuoteFormState,
} from "@/lib/leads/public-form-payload";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-heading", className: "font" }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/field", () => ({
  Field: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  FieldLabel: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) =>
    createElement("label", { htmlFor }, children),
  FieldHint: ({ children }: { children?: ReactNode }) => createElement("p", null, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));

vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
    createElement("select", props, children),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => createElement("textarea", props),
}));

import { RequestQuoteForm } from "./request-quote-form";

function renderForm() {
  return renderToStaticMarkup(
    createElement(RequestQuoteForm, {
      slug: "acme-lawn",
      orgName: "Acme Lawn",
      services: ["Mowing", "Fertilization"],
      consentText: "I agree to receive SMS updates about my request.",
      responseTargetMinutes: 60,
      turnstileSiteKey: null,
    }),
  );
}

describe("RequestQuoteForm (hosted L05)", () => {
  it("is phone-width (single column max-w-md) and shows no price", () => {
    const html = renderForm();
    expect(html).toContain('data-phone-width');
    expect(html).toContain("max-w-md");
    expect(html.toLowerCase()).not.toMatch(/\$\d/);
    expect(html.toLowerCase()).not.toContain("price");
    expect(html.toLowerCase()).not.toContain("estimate");
  });

  it("leaves SMS consent unchecked by default", () => {
    const html = renderForm();
    expect(html).toContain('name="sms_consent"');
    expect(html).not.toMatch(/name="sms_consent"[^>]*checked/);
  });

  it("phone-width submission succeeds through intake with consent false", async () => {
    const state: HostedQuoteFormState = {
      slug: "acme-lawn",
      contactName: "Pat",
      addressTyped: "unknown lane near creek",
      phone: "5125550199",
      email: "",
      services: ["Mowing"],
      note: "",
      preferredContact: "",
      isBusiness: false,
      smsConsent: false,
      heardAbout: "Google",
      heardAboutOther: "",
      turnstileToken: "tok",
      honeypot: "",
      formStartedAtMs: Date.now() - 5_000,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      referrer: null,
      landingPage: "https://app.example/r/acme-lawn",
    };
    const body = buildHostedIntakeBody(state);
    expect(body.smsConsent).toBe(false);
    expect(body.addressTyped).toBe("unknown lane near creek");

    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("/api/leads/intake");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const result = await submitHostedQuoteRequest(body, fetchImpl as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
