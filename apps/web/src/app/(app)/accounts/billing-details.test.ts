import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_DETAILS_LABEL,
  billingAddressDraft,
  billingEmailDraft,
  shouldOpenBillingDetails,
} from "./billing-details";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("./rail-actions", () => ({
  updateAccountBilling: vi.fn(async () => ({ ok: true })),
  updateAccountSales: vi.fn(async () => ({ ok: true })),
  updateAccountNotes: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/components/entry", async () => {
  const actual = await vi.importActual<typeof import("@/components/entry")>("@/components/entry");
  return {
    ...actual,
    useSectionAutosave: () => ({
      status: "idle" as const,
      error: null,
      save: vi.fn(),
      retry: vi.fn(),
    }),
  };
});

import { AccountRail } from "./[id]/account-rail";

const property = {
  address_line1: "12 Oak St",
  address_line2: "Unit B",
  city: "Austin",
  region: "TX",
  postal_code: "78701",
};

describe("billing details defaults", () => {
  it("keeps billing email blank and never copies the account email", () => {
    expect(billingEmailDraft(null, "pat@example.com")).toBe("");
    expect(billingEmailDraft("", "pat@example.com")).toBe("");
    expect(billingEmailDraft("ap@firm.com", "pat@example.com")).toBe("ap@firm.com");
  });

  it("defaults billing address to the first property when unset", () => {
    expect(
      billingAddressDraft(
        {
          billing_address_line1: null,
          billing_address_line2: null,
          billing_city: null,
          billing_region: null,
          billing_postal_code: null,
        },
        property,
      ),
    ).toEqual({
      billing_address_line1: "12 Oak St",
      billing_address_line2: "Unit B",
      billing_city: "Austin",
      billing_region: "TX",
      billing_postal_code: "78701",
    });

    expect(
      billingAddressDraft(
        {
          billing_address_line1: "99 Bill Ave",
          billing_address_line2: null,
          billing_city: "Dallas",
          billing_region: "TX",
          billing_postal_code: "75201",
        },
        property,
      ),
    ).toEqual({
      billing_address_line1: "99 Bill Ave",
      billing_address_line2: "",
      billing_city: "Dallas",
      billing_region: "TX",
      billing_postal_code: "75201",
    });

    expect(
      billingAddressDraft(
        {
          billing_address_line1: null,
          billing_address_line2: null,
          billing_city: null,
          billing_region: null,
          billing_postal_code: null,
        },
        null,
      ),
    ).toEqual({
      billing_address_line1: "",
      billing_address_line2: "",
      billing_city: "",
      billing_region: "",
      billing_postal_code: "",
    });
  });
});

describe("billing details disclosure", () => {
  it("shows + Billing details on a residential account with no billing data", () => {
    const account = {
      id: "acct-1",
      org_id: "org-1",
      type: "residential" as const,
      status: "lead" as const,
      name: "Pat Customer",
      company_name: null,
      email: "pat@example.com",
      phone: "555-0100",
      billing_email: null,
      billing_address_line1: null,
      billing_address_line2: null,
      billing_city: null,
      billing_region: null,
      billing_postal_code: null,
      net_terms_days: 0,
      po_required: false,
      tax_exempt: false,
      consolidated_invoicing: false,
      parent_account_id: null,
      lead_source: null,
      lead_source_other: null,
      notes: null,
      tags: [] as string[],
      created_by: null,
      stripe_customer_id: null,
      auto_charge: false,
      qbo_customer_id: null,
      tax_exempt_certificate: null,
      collections_flagged_at: null,
      payment_dispute_open: false,
      promise_to_pay_until: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };

    expect(shouldOpenBillingDetails(account)).toBe(false);

    const markup = renderToStaticMarkup(
      createElement(AccountRail, {
        account,
        parents: [],
        ownerName: "Dusty",
        firstProperty: property,
      }),
    );
    expect(markup).toContain(BILLING_DETAILS_LABEL);
    expect(markup).not.toContain('id="billing_email"');
  });

  it("uses the shared + Billing details label", () => {
    expect(BILLING_DETAILS_LABEL).toBe("+ Billing details");
  });
});
