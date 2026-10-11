import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn(async () => ({ id: "msg_1", sent: true }));
const renderToBuffer = vi.fn(async (_node: unknown) => new Uint8Array([1, 2, 3]));

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: (node: unknown) => renderToBuffer(node),
}));

vi.mock("@/lib/email/provider", () => ({
  createEmailProvider: () => ({ send }),
}));

vi.mock("@/app/i/[token]/invoice-pdf", () => ({
  InvoicePdf: () => null,
}));

import { notifyIssuedInvoice } from "./notify-issued-invoice";

describe("notifyIssuedInvoice", () => {
  beforeEach(() => {
    send.mockClear();
    renderToBuffer.mockClear();
  });

  it("sends one email with the public link and PDF after issue", async () => {
    const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const supabase = {
      from(table: string) {
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "inv-1",
                      public_token: token,
                      account_id: "acct-1",
                      status: "issued",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "accounts") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { email: "owner@acme.test", billing_email: "billing@acme.test" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async (name: string) => {
        expect(name).toBe("invoice_public");
        return {
          data: {
            number_label: "INV-2026-0001",
            org: { name: "Green Co", logo_raster_url: null },
            lines: [],
            total_cents: 36500,
            account_name: "Acme",
          },
          error: null,
        };
      },
    };

    const result = await notifyIssuedInvoice({
      supabase: supabase as never,
      invoiceId: "inv-1",
      orgId: "org-1",
      appBaseUrl: "https://app.example.com",
    });

    expect(result).toEqual({ emailed: true, publicToken: token });
    expect(renderToBuffer).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls.at(0)?.at(0) as
      | { to: string; text: string; attachments: { filename: string }[] }
      | undefined;
    expect(message?.to).toBe("billing@acme.test");
    expect(message?.text).toContain(`https://app.example.com/i/${token}`);
    expect(message?.attachments[0]?.filename).toBe("INV-2026-0001.pdf");
  });
});
