import { describe, expect, it } from "vitest";
import { issuedInvoiceMessage } from "./issued-invoice";

describe("issuedInvoiceMessage", () => {
  it("includes the tokenized invoice link and PDF attachment", () => {
    const pdf = Buffer.from("%PDF-1.4");
    const message = issuedInvoiceMessage({
      to: "billing@example.com",
      orgName: "Green Co",
      numberLabel: "INV-2026-0001",
      invoiceUrl: "https://app.example.com/i/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      pdf,
    });

    expect(message.to).toBe("billing@example.com");
    expect(message.subject).toContain("INV-2026-0001");
    expect(message.text).toContain("https://app.example.com/i/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(message.html).toContain("/i/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(message.attachments).toEqual([
      {
        filename: "INV-2026-0001.pdf",
        content: pdf,
        contentType: "application/pdf",
      },
    ]);
  });
});
