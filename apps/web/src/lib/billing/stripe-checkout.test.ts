import { describe, expect, it, vi } from "vitest";
import {
  checkoutIdempotencyKey,
  startInvoiceCheckout,
  type CheckoutInvoice,
} from "./stripe-checkout";

const INVOICE: CheckoutInvoice = {
  id: "inv-1",
  orgId: "org-1",
  accountId: "acct-1",
  number: 42,
  numberLabel: "INV-2026-0042",
  status: "issued",
  currency: "usd",
  totalCents: 12500,
  publicToken: "11111111-1111-4111-8111-111111111111",
};

describe("checkoutIdempotencyKey", () => {
  it("scopes Stripe Checkout creates to the invoice", () => {
    expect(checkoutIdempotencyKey("inv-1")).toBe("lawnquoter_invoice_checkout_inv-1");
  });
});

describe("startInvoiceCheckout", () => {
  it("creates a Checkout Session on the connected account for card and ACH", async () => {
    const sessionsCreate = vi.fn().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const result = await startInvoiceCheckout({
      invoice: INVOICE,
      stripeAccountId: "acct_connected",
      successUrl: "https://app.example/i/tok?paid=1",
      cancelUrl: "https://app.example/i/tok",
      stripe: { checkout: { sessions: { create: sessionsCreate } } },
    });
    expect(result).toEqual({
      ok: true as const,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      sessionId: "cs_test_1",
    });
    expect(sessionsCreate).toHaveBeenCalledWith(
      {
        mode: "payment",
        payment_method_types: ["card", "us_bank_account"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: 12500,
              product_data: { name: "Invoice INV-2026-0042" },
            },
          },
        ],
        success_url: "https://app.example/i/tok?paid=1",
        cancel_url: "https://app.example/i/tok",
        client_reference_id: "inv-1",
        metadata: {
          lawnquoter_invoice_id: "inv-1",
          lawnquoter_org_id: "org-1",
          lawnquoter_account_id: "acct-1",
          lawnquoter_public_token: INVOICE.publicToken,
        },
        payment_intent_data: {
          metadata: {
            lawnquoter_invoice_id: "inv-1",
            lawnquoter_org_id: "org-1",
            lawnquoter_account_id: "acct-1",
          },
        },
      },
      {
        stripeAccount: "acct_connected",
        idempotencyKey: "lawnquoter_invoice_checkout_inv-1",
      },
    );
  });

  it("rejects invoices that are not issued or have a non-positive balance", async () => {
    const sessionsCreate = vi.fn();
    expect(
      await startInvoiceCheckout({
        invoice: { ...INVOICE, status: "paid" },
        stripeAccountId: "acct_connected",
        successUrl: "https://app.example/i/tok?paid=1",
        cancelUrl: "https://app.example/i/tok",
        stripe: { checkout: { sessions: { create: sessionsCreate } } },
      }),
    ).toEqual({ ok: false as const, reason: "not_payable" });
    expect(
      await startInvoiceCheckout({
        invoice: { ...INVOICE, totalCents: 0 },
        stripeAccountId: "acct_connected",
        successUrl: "https://app.example/i/tok?paid=1",
        cancelUrl: "https://app.example/i/tok",
        stripe: { checkout: { sessions: { create: sessionsCreate } } },
      }),
    ).toEqual({ ok: false as const, reason: "not_payable" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects when Connect is not ready", async () => {
    expect(
      await startInvoiceCheckout({
        invoice: INVOICE,
        stripeAccountId: null,
        successUrl: "https://app.example/i/tok?paid=1",
        cancelUrl: "https://app.example/i/tok",
        stripe: { checkout: { sessions: { create: vi.fn() } } },
      }),
    ).toEqual({ ok: false as const, reason: "connect_not_ready" });
  });
});
