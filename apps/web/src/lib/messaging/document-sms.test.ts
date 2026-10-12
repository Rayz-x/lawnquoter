import { describe, expect, it } from "vitest";
import { TWILIO_NOT_CONNECTED } from "./sms";
import { documentSms, pickSmsContact } from "./document-sms";

const contact = { id: "c1", to: "+15551110000", optedIn: true, inbound: false };
const ready = {
  purpose: "quote" as const,
  status: "draft",
  templateBody: null,
  customerName: "Pat Lee",
  company: "North Lawn",
  link: "https://example.com/q/abc",
  amount: "$86.00",
  address: "100 Maple St",
  contact,
  connected: true,
};

describe("document texts", () => {
  it("stays off until Twilio is connected", () => {
    expect(documentSms({ ...ready, connected: false })).toEqual({ ok: false, error: TWILIO_NOT_CONNECTED });
  });

  it("refuses a person who has not agreed to texts", () => {
    expect(documentSms({ ...ready, contact: { ...contact, optedIn: false } })).toEqual({
      ok: false,
      error: "This person has not agreed to texts.",
    });
  });

  it("uses the suggested quote wording and the public link when no template is saved", () => {
    expect(documentSms(ready)).toEqual({
      ok: true,
      to: "+15551110000",
      body: "Hi Pat Lee, North Lawn sent your quote: https://example.com/q/abc",
    });
  });

  it("fills the saved invoice template and still includes the public link", () => {
    expect(
      documentSms({
        ...ready,
        purpose: "invoice",
        status: "issued",
        templateBody: "Amount {amount} for {customer name}.",
        link: "https://example.com/i/inv",
      }),
    ).toEqual({
      ok: true,
      to: "+15551110000",
      body: "Amount $86.00 for Pat Lee. https://example.com/i/inv",
    });
  });

  it("asks for a mobile number when the account has none", () => {
    expect(documentSms({ ...ready, contact: null })).toEqual({
      ok: false,
      error: "Add a mobile number on this account before texting.",
    });
  });

  it("does not text a quote that can no longer record a view", () => {
    expect(documentSms({ ...ready, status: "accepted" })).toEqual({
      ok: false,
      error: "This quote can no longer be texted.",
    });
    expect(documentSms({ ...ready, status: "sent" }).ok).toBe(true);
  });

  it("does not text a draft or void invoice", () => {
    expect(documentSms({ ...ready, purpose: "invoice", status: "draft" }).ok).toBe(false);
    expect(documentSms({ ...ready, purpose: "invoice", status: "void" })).toEqual({
      ok: false,
      error: "A void invoice cannot be texted.",
    });
  });

  it("picks an opted-in mobile number, then someone who already texted", () => {
    const contacts = [
      { id: "a", phone: "5550001111", smsOptIn: false },
      { id: "b", phone: "(555) 111-0000", smsOptIn: true },
    ];
    expect(pickSmsContact(contacts, [])).toMatchObject({ id: "b", to: "+15551110000", optedIn: true });
    expect(pickSmsContact([{ id: "a", phone: "5550001111", smsOptIn: false }], ["+15550001111"])).toMatchObject({
      id: "a",
      inbound: true,
    });
    expect(pickSmsContact([{ id: "a", phone: "5550001111", smsOptIn: false }], [])).toMatchObject({
      id: "a",
      optedIn: false,
      inbound: false,
    });
    expect(pickSmsContact([{ id: "a", phone: "", smsOptIn: true }], [])).toBeNull();
  });
});
