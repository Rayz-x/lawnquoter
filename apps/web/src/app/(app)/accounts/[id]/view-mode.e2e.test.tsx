import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Tables } from "@/lib/supabase/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("../identity-action", () => ({
  updateAccountIdentity: vi.fn(),
  findAccountMatch: vi.fn(),
  archiveAccount: vi.fn(),
  setAccountStatus: vi.fn(),
}));
vi.mock("../rail-actions", () => ({
  updateAccountBilling: vi.fn(),
  updateAccountNotes: vi.fn(),
  updateAccountSales: vi.fn(),
}));
vi.mock("../actions", () => ({
  addContact: vi.fn(),
  deleteContact: vi.fn(),
  createProperty: vi.fn(),
}));
vi.mock("../address-suggest", () => ({ suggestPropertyAddresses: vi.fn(async () => []) }));

import { AccountHeader } from "./account-header";
import { AccountRail } from "./account-rail";
import { ContactsPanel } from "./contacts-panel";
import { IdentityCard } from "./identity-card";
import { PropertyQuickAdd } from "./property-quick-add";

function html(node: ReactNode) {
  return renderToStaticMarkup(node);
}

function hasEditControls(markup: string) {
  return /<input\b|<textarea\b|<select\b/i.test(markup);
}

const account = {
  id: "acct-1",
  org_id: "org-1",
  parent_account_id: null,
  type: "residential",
  status: "active",
  name: "Ada Lovelace",
  company_name: null,
  email: "ada@example.com",
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
  lead_source: "Referral",
  tags: ["weekly"],
  notes: "Side gate",
  created_by: "user-1",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
} as Tables<"accounts">;

describe("account view mode for no-edit roles", () => {
  it("renders identity, rail, contacts, and header without inputs when canEdit is false", () => {
    const markup = [
      html(createElement(IdentityCard, { account, canEdit: false })),
      html(createElement(AccountRail, { account, parents: [], ownerName: "Dusty", canEdit: false })),
      html(createElement(ContactsPanel, { accountId: account.id, contacts: [], canEdit: false })),
      html(createElement(PropertyQuickAdd, { accountId: account.id, canEdit: false })),
      html(createElement(AccountHeader, { account, primaryName: null, canEdit: false })),
    ].join("\n");

    expect(hasEditControls(markup)).toBe(false);
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("data-mode=\"view\"");
    expect(markup).not.toContain("Edit Name:");
    expect(markup).not.toContain("Add contact");
    expect(markup).not.toContain("Add and measure");
    expect(markup).not.toContain("New quote");
  });

  it("keeps edit controls when canEdit is true", () => {
    const markup = html(createElement(IdentityCard, { account, canEdit: true }));
    expect(markup).toContain("Edit Name:");
  });
});
